import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PageGeometry } from '../pdf/coords';

export interface SignatureAsset {
  id: string;
  kind: 'signature' | 'initials';
  source: 'drawn' | 'typed' | 'uploaded';
  pngBytes: ArrayBuffer;
  width: number;
  height: number;
  strokeData?: string;
  typedText?: string;
  typedFont?: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface SignatureSnapshot {
  id: string;
  kind: 'signature' | 'initials';
  pngBytes: ArrayBuffer;
  width: number;
  height: number;
}

export type SignatureSnapshotMap = Record<string, SignatureSnapshot>;

export interface Placement {
  id: string;
  type: 'signature' | 'initials' | 'date' | 'text';
  snapshotId?: string;
  /** Legacy compatibility for sessions created before signature snapshots. */
  assetId?: string;
  assetPngBytes?: ArrayBuffer;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value?: string;
  fontSize?: number;
}

export interface SessionDocument {
  docId: string;
  fileName: string;
  pdfBytes: ArrayBuffer;
  pageCount: number;
  pageSizes: { w: number; h: number }[];
  /** Derived from the source PDF at intake; must agree with the immutable bytes. Reconstructed for legacy sessions. */
  pageGeometry?: PageGeometry[];
  placements: Placement[];
  status: 'pending' | 'placed' | 'signing' | 'signed' | 'needs-review' | 'error';
  batchError?: string;
  /** Orthogonal review state; a Signed Document may still require review. */
  needsReviewReason?: string;
}

export interface WorkSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  documents: SessionDocument[];
  templatePlacements: Placement[];
  /** Optional while reading legacy sessions; normalized to an empty map by the store. */
  signatureSnapshots?: SignatureSnapshotMap;
  /** Optimistic-concurrency token written only by the history repository.
   *  Independent of the in-memory content revision. Legacy records read as 0. */
  storageRevision?: number;
}

export interface Prefs {
  dateFormat: string;
  lastExportAt?: number;
  /** Newly added signature assets since the last export-offer watermark; the
   *  backup reminder fires at 10. Absent in legacy prefs and read as 0. */
  assetsAddedSinceExport?: number;
}

interface SignLiteDb extends DBSchema {
  signatures: {
    key: string;
    value: SignatureAsset;
    indexes: { 'by-kind': SignatureAsset['kind']; 'by-last-used': number };
  };
  sessions: {
    key: string;
    value: WorkSession;
    indexes: { 'by-updated-at': number };
  };
  prefs: {
    key: string;
    value: Prefs;
  };
}

let dbPromise: Promise<IDBPDatabase<SignLiteDb>> | null = null;

/** The lowest database version this bundle can read. Old bundles below the
 *  current version must stop and request refresh, never overwrite. */
export const MIN_COMPATIBLE_DB_VERSION = 1;

export async function openSignliteDb() {
  if (!dbPromise) {
    dbPromise = openDB<SignLiteDb>('signlite', MIN_COMPATIBLE_DB_VERSION, {
      upgrade(db) {
        const signatures = db.createObjectStore('signatures', { keyPath: 'id' });
        signatures.createIndex('by-kind', 'kind');
        signatures.createIndex('by-last-used', 'lastUsedAt');

        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-updated-at', 'updatedAt');

        db.createObjectStore('prefs');
      },
      // Another tab holds an older connection and is blocking this upgrade.
      blocked() {
      },
      // This (older) connection is blocking another tab's upgrade; close so
      // the upgrade can proceed.
      blocking() {
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      // The browser killed the connection (e.g. under storage pressure); the
      // next open re-establishes it instead of reusing a dead handle.
      terminated() {
        dbPromise = null;
      }
    });
  }
  return dbPromise;
}
