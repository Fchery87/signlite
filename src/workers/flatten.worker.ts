import { zipSync } from 'fflate';
import type { SessionDocument, SignatureSnapshotMap } from '../db/schema';
import { dedupeFileName, signedPdfFileName } from '../lib/downloadNames';
import { STRINGS } from '../lib/strings';
import type { FlattenAssetMap } from '../pdf/assets';
import { flattenDocument } from '../pdf/flatten';

export type FlattenWorkerRequest = {
  kind: 'flatten';
  docs: SessionDocument[];
  snapshots?: SignatureSnapshotMap;
  /** Legacy assets for sessions whose Placements predate snapshots. */
  assets: FlattenAssetMap;
  zip: boolean;
  dateFormat?: string;
};

export type FlattenWorkerProgressMessage = {
  kind: 'progress';
  docId: string;
  done: number;
  total: number;
};

export type FlattenWorkerDoneMessage = {
  kind: 'done';
  output: ArrayBuffer;
  mime: 'application/pdf' | 'application/zip';
};

export type FlattenWorkerErrorMessage = {
  kind: 'error';
  docId?: string;
  message: string;
};

export type FlattenWorkerResponse = FlattenWorkerProgressMessage | FlattenWorkerDoneMessage | FlattenWorkerErrorMessage;

type WorkerLike = {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as typeof globalThis & {
  importScripts?: (...urls: string[]) => void;
  onmessage?: (event: MessageEvent<FlattenWorkerRequest>) => void;
  postMessage?: (message: unknown, transfer?: Transferable[]) => void;
};

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function runFlattenJob(request: FlattenWorkerRequest, worker?: WorkerLike) {
  const successfulDocs: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let successCount = 0;

  for (const [index, document] of request.docs.entries()) {
    try {
      const flattened = await flattenDocument(document, {
        snapshots: request.snapshots,
        assetMap: request.assets,
        dateFormat: request.dateFormat
      });
      const fileName = dedupeFileName(signedPdfFileName(document.fileName), usedNames);
      successfulDocs[fileName] = flattened;
      successCount += 1;
      worker?.postMessage({
        kind: 'progress',
        docId: document.docId,
        done: index + 1,
        total: request.docs.length
      } satisfies FlattenWorkerProgressMessage);
    } catch (error) {
      worker?.postMessage({
        kind: 'error',
        docId: document.docId,
        message: error instanceof Error ? error.message : STRINGS.editor.downloadFailed
      } satisfies FlattenWorkerErrorMessage);
    }
  }

  if (successCount === 0) {
    throw new Error(request.zip ? STRINGS.batch.batchFailedAll : STRINGS.editor.downloadFailed);
  }

  if (request.zip) {
    const output = zipSync(successfulDocs, { level: 0 });
    return {
      kind: 'done',
      output: toArrayBuffer(output),
      mime: 'application/zip'
    } satisfies FlattenWorkerDoneMessage;
  }

  const [firstDocument] = Object.values(successfulDocs);
  if (!firstDocument) {
    throw new Error(STRINGS.editor.downloadFailed);
  }

  return {
    kind: 'done',
    output: toArrayBuffer(firstDocument),
    mime: 'application/pdf'
  } satisfies FlattenWorkerDoneMessage;
}

if (typeof workerScope.importScripts === 'function' && workerScope.postMessage) {
  workerScope.onmessage = async (event: MessageEvent<FlattenWorkerRequest>) => {
    if (event.data.kind !== 'flatten') {
      return;
    }

    try {
      const result = await runFlattenJob(event.data, workerScope as WorkerLike);
      workerScope.postMessage(result, [result.output]);
    } catch (error) {
      workerScope.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : STRINGS.batch.batchFailed
      } satisfies FlattenWorkerErrorMessage);
    }
  };
}
