import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

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

export interface Placement {
  id: string;
  type: 'signature' | 'initials' | 'date' | 'text';
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
  placements: Placement[];
  status: 'pending' | 'placed' | 'signing' | 'signed' | 'needs-review' | 'error';
  batchError?: string;
}

export interface WorkSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  documents: SessionDocument[];
  templatePlacements: Placement[];
}

export interface Prefs {
  dateFormat: string;
  lastExportAt?: number;
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

export async function openSignliteDb() {
  if (!dbPromise) {
    dbPromise = openDB<SignLiteDb>('signlite', 1, {
      upgrade(db) {
        const signatures = db.createObjectStore('signatures', { keyPath: 'id' });
        signatures.createIndex('by-kind', 'kind');
        signatures.createIndex('by-last-used', 'lastUsedAt');

        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-updated-at', 'updatedAt');

        db.createObjectStore('prefs');
      }
    });
  }
  return dbPromise;
}
