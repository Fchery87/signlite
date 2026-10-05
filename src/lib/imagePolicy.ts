/** Shared image and import policy limits. Both library imports and signature
 *  uploads enforce the same processing boundaries; numbers live here so the
 *  fixtures and receipts can verify them in one place. */

/** Import envelope limits: bound work before parsing and decoding. */
export const IMPORT_MAX_JSON_BYTES = 64 * 1024 * 1024;
export const IMPORT_MAX_ASSETS = 1000;
export const IMPORT_MAX_DECODED_BYTES = 64 * 1024 * 1024;

/** One PNG, imported or uploaded, may not exceed the existing upload limit. */
export const IMPORT_MAX_PNG_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_FILE_BYTES = IMPORT_MAX_PNG_BYTES;

/** Canvas allocation caps: reject beyond these before any canvas exists, and
 *  normalize uploads down to stay inside them without changing aspect ratio. */
export const MAX_EDGE_PIXELS = 4096;
export const MAX_PIXEL_AREA = 16_000_000;

export type Dimensions = { width: number; height: number };

export function dimensionsExceedProcessingCaps({ width, height }: Dimensions) {
  return width > MAX_EDGE_PIXELS || height > MAX_EDGE_PIXELS || width * height > MAX_PIXEL_AREA;
}

/** Scale down so both caps hold, preserving aspect ratio. Never scales up. */
export function normalizedUploadDimensions({ width, height }: Dimensions): Dimensions {
  const scale = Math.min(1, MAX_EDGE_PIXELS / width, MAX_EDGE_PIXELS / height, Math.sqrt(MAX_PIXEL_AREA / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}
