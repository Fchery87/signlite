import { zipSync } from 'fflate';
import type { SessionDocument, SignatureSnapshotMap } from '../db/schema';
import { dedupeFileName, signedPdfFileName } from '../lib/downloadNames';
import { STRINGS } from '../lib/strings';
import type { FlattenAssetMap } from '../pdf/assets';
import { assertTextExportable, flattenDocument } from '../pdf/flatten';

export type FlattenWorkerRequest = {
  kind: 'flatten';
  docs: SessionDocument[];
  snapshots?: SignatureSnapshotMap;
  /** Legacy assets for sessions whose Placements predate snapshots. */
  assets: FlattenAssetMap;
  zip: boolean;
  dateFormat?: string;
  /** One instant for every date in the attempt, so documents in one batch
   *  cannot disagree across a midnight. */
  resolvedAt?: number;
  /** Identifies the attempt. The worker is resident and reused across
   *  attempts, so every response echoes this and a caller ignores responses
   *  from a job that is no longer its own. */
  jobId?: string;
};

export type FlattenWorkerProgressMessage = {
  kind: 'progress';
  docId: string;
  done: number;
  total: number;
  jobId?: string;
};

export type FlattenWorkerDoneMessage = {
  kind: 'done';
  output: ArrayBuffer;
  mime: 'application/pdf' | 'application/zip';
  jobId?: string;
};

export type FlattenWorkerErrorMessage = {
  kind: 'error';
  docId?: string;
  message: string;
  jobId?: string;
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
      // Specific rejection before the write path, whose catch masks messages.
      await assertTextExportable(document, { dateFormat: request.dateFormat, resolvedAt: request.resolvedAt });
      const flattened = await flattenDocument(document, {
        snapshots: request.snapshots,
        assetMap: request.assets,
        dateFormat: request.dateFormat,
        resolvedAt: request.resolvedAt
      });
      const fileName = dedupeFileName(signedPdfFileName(document.fileName), usedNames);
      successfulDocs[fileName] = flattened;
      successCount += 1;
      worker?.postMessage({
        kind: 'progress',
        docId: document.docId,
        done: index + 1,
        total: request.docs.length,
        jobId: request.jobId
      } satisfies FlattenWorkerProgressMessage);
    } catch (error) {
      worker?.postMessage({
        kind: 'error',
        docId: document.docId,
        message: error instanceof Error ? error.message : STRINGS.editor.downloadFailed,
        jobId: request.jobId
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
    mime: 'application/pdf',
    jobId: request.jobId
  } satisfies FlattenWorkerDoneMessage;
}

if (typeof workerScope.importScripts === 'function' && workerScope.postMessage) {
  // The worker is resident and shared across batch attempts, so jobs queue
  // behind each other instead of interleaving their progress messages.
  let jobChain: Promise<unknown> = Promise.resolve();
  workerScope.onmessage = (event: MessageEvent<FlattenWorkerRequest | { kind: 'ping' }>) => {
    if (event.data.kind === 'ping') {
      workerScope.postMessage({ kind: 'pong' });
      return;
    }
    if (event.data.kind !== 'flatten') {
      return;
    }
    const request = event.data;
    const run = jobChain.then(async () => {
      try {
        const result = await runFlattenJob(request, workerScope as WorkerLike);
        workerScope.postMessage(result, [result.output]);
      } catch (error) {
        workerScope.postMessage({
          kind: 'error',
          message: error instanceof Error ? error.message : STRINGS.batch.batchFailed,
          jobId: request.jobId
        } satisfies FlattenWorkerErrorMessage);
      }
    });
    jobChain = run.catch(() => undefined);
  };
}
