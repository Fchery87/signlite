// Session resource ceilings, measured in source bytes and pages. These bound
// the stored session, not total process memory. Enforcement lives in the
// WorkSessionEditor domain (addDocuments); intake validation reads the same
// numbers so rejection copy matches what the store will refuse.
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_SESSION_FILES = 50;
export const MAX_SESSION_PAGES = 500;
export const MAX_SESSION_BYTES = 500 * 1024 * 1024;

export type SessionResourceBudget = {
  documentCount: number;
  pageCount: number;
  byteCount: number;
};
