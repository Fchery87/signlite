import type { SignatureAsset } from '../../db/schema';
import { saveAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { UPLOAD_MAX_FILE_BYTES } from '../../lib/imagePolicy';
import { canvasToPngBytes, imageFileToCanvas } from './canvas';

export type UploadSignatureResult =
  | { ok: true; asset: SignatureAsset }
  | { ok: false; message: string };

/** Saves a PNG or JPEG as a signature. Shared by the library tray and the
 *  document queue so both entry points enforce the same limits. */
export async function uploadSignatureFile(file: File): Promise<UploadSignatureResult> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > UPLOAD_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: STRINGS.errors[file.size > UPLOAD_MAX_FILE_BYTES ? 'upload-too-large' : 'upload-invalid']
    };
  }

  try {
    const canvas = await imageFileToCanvas(file);
    const asset = await saveAsset({
      kind: 'signature',
      source: 'uploaded',
      pngBytes: await canvasToPngBytes(canvas),
      width: canvas.width,
      height: canvas.height,
      label: file.name.replace(/\.[^.]+$/, '') || 'Uploaded signature'
    });
    return { ok: true, asset };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message === STRINGS.errors.quota
        ? STRINGS.errors.quota
        : error instanceof Error ? error.message : STRINGS.library.uploadFailed
    };
  }
}
