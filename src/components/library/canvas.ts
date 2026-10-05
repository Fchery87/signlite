import { normalizedUploadDimensions } from '../../lib/imagePolicy';

const PNG_TYPE = 'image/png';

export type DrawStroke = Array<{ x: number; y: number }>;

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Could not encode image.'));
    }, PNG_TYPE);
  });
  return blob.arrayBuffer();
}

export function trimCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = source.getContext('2d');
  if (!context) return null;
  const { width, height } = source;
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) continue;
      top = Math.min(top, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    return null;
  }

  const padding = 8;
  const cropLeft = Math.max(0, left - padding);
  const cropTop = Math.max(0, top - padding);
  const cropWidth = Math.min(width - cropLeft, right - left + 1 + padding * 2);
  const cropHeight = Math.min(height - cropTop, bottom - top + 1 + padding * 2);

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const nextContext = canvas.getContext('2d');
  if (!nextContext) return null;
  nextContext.putImageData(context.getImageData(cropLeft, cropTop, cropWidth, cropHeight), 0, 0);
  return canvas;
}

export function renderStrokes(
  canvas: HTMLCanvasElement,
  strokes: DrawStroke[],
  options: { strokeStyle?: string; lineWidth?: number } = {}
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = options.strokeStyle ?? '#111827';
  context.lineWidth = options.lineWidth ?? 6;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of strokes) {
    // A malformed stroke must never take the whole app down with it.
    if (!Array.isArray(stroke) || stroke.length === 0) continue;
    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    if (stroke.length === 1) {
      context.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
    } else {
      for (const point of stroke.slice(1)) {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
  }
}

export function renderTypedTextToCanvas(
  text: string,
  fontFamily: string,
  kind: 'signature' | 'initials'
): HTMLCanvasElement {
  const scale = 2;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2d context unavailable');
  }

  const fontSize = kind === 'initials' ? 52 : 68;
  context.font = `${fontSize * scale}px ${fontFamily}`;
  const metrics = context.measureText(text);
  const width = Math.max(220, Math.ceil(metrics.width + 48 * scale));
  const height = Math.max(120, Math.ceil(fontSize * scale + 40 * scale));
  canvas.width = width;
  canvas.height = height;

  const nextContext = canvas.getContext('2d');
  if (!nextContext) {
    throw new Error('2d context unavailable');
  }
  nextContext.clearRect(0, 0, width, height);
  nextContext.font = `${fontSize * scale}px ${fontFamily}`;
  nextContext.fillStyle = '#111827';
  nextContext.textBaseline = 'middle';
  nextContext.fillText(text, 24 * scale, height / 2);
  return trimCanvas(canvas) ?? canvas;
}

export async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('Could not read this image.'));
      value.src = url;
    });

    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    if (natural.width <= 0 || natural.height <= 0) {
      throw new Error('Could not read this image.');
    }
    // Uploads are normalized into the processing caps before any canvas
    // allocation, preserving aspect ratio; imports (exact bytes) reject
    // beyond the caps instead.
    const target = normalizedUploadDimensions(natural);

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2d context unavailable');
    }
    context.drawImage(image, 0, 0, target.width, target.height);
    // The decoded bitmap is no longer needed once it is drawn.
    image.src = '';
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function bufferToObjectUrl(buffer: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buffer], { type: PNG_TYPE }));
}

/** Bundled font faces with their URLs, for recovery loads: a font face that
 *  failed on a transient network error is stuck in `error` status and a plain
 *  re-check never recovers it, so a fresh FontFace must be added. */
const BUNDLED_FONTS: Array<{ family: string; url: string }> = [
  { family: 'SignLite Caveat', url: '/fonts/Caveat-Regular.ttf' },
  { family: 'SignLite Homemade Apple', url: '/fonts/HomemadeApple-Regular.ttf' }
];
const fontRecovery = new Map<string, Promise<boolean>>();

function firstBundledFamily(fontFamily: string) {
  const quoted = /"([^"]+)"/.exec(fontFamily);
  const name = quoted?.[1] ?? fontFamily.split(',')[0]?.trim();
  return BUNDLED_FONTS.find((font) => font.family === name) ?? null;
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, '').toLowerCase();

/** Whether a face for this family has finished loading.
 *
 *  `document.fonts.check` is deliberately not used here: it consults every face
 *  matching the family, so one face left in `error` by an earlier failed fetch
 *  reports false even after a recovery face loaded successfully. Face status is
 *  the authoritative signal, and families round-trip through the FontFaceSet
 *  quoted when they contain spaces. */
function familyIsLoaded(family: string): boolean {
  const target = unquote(family);
  return [...document.fonts].some((face) => unquote(face.family) === target && face.status === 'loaded');
}

/** Waits for the requested bundled font and verifies it actually loaded, so a
 *  generated PNG never captures fallback typography. Returns false when the
 *  font cannot be confirmed; callers surface a retryable failure. */
export async function ensureFontReady(fontFamily: string, sampleText: string): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return true;
  const bundled = firstBundledFamily(fontFamily);
  const primary = bundled?.family ?? unquote(fontFamily.split(',')[0] ?? fontFamily);
  try {
    await document.fonts.load(`68px ${fontFamily}`, sampleText);
  } catch {
    // A rejected load leaves the face unusable; the status check below decides
    // whether a recovery load is still worth attempting.
  }
  if (familyIsLoaded(primary)) return true;
  if (!bundled || typeof FontFace === 'undefined') return false;

  // Share one in-flight recovery per family, but never remember a failed
  // attempt: a transient network failure must not poison every later retry.
  const inFlight = fontRecovery.get(bundled.family);
  if (inFlight) return inFlight;

  const attempt = (async () => {
    try {
      const face = new FontFace(bundled.family, `url(${bundled.url})`);
      document.fonts.add(face);
      await face.load();
    } catch {
      // Fall through to the status check below.
    }
    return familyIsLoaded(primary);
  })();

  fontRecovery.set(bundled.family, attempt);
  try {
    return await attempt;
  } finally {
    if (fontRecovery.get(bundled.family) === attempt) fontRecovery.delete(bundled.family);
  }
}
