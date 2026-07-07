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
    if (stroke.length === 0) continue;
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

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2d context unavailable');
    }
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function bufferToObjectUrl(buffer: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([buffer], { type: PNG_TYPE }));
}
