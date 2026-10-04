export type PageSize = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type RectClampOptions = { minW?: number; minH?: number };
export type AffineMatrix = [number, number, number, number, number, number];
export type ViewBox = { x: number; y: number; w: number; h: number };

/**
 * Serializable effective geometry of one PDF page, captured from the PDF.js
 * scale-1 viewport that also drives the preview. `transform` maps PDF user-space
 * points into viewport points (physical points; UserUnit included). Placements
 * stay normalized in viewer coordinates.
 */
export type PageGeometry = {
  width: number;
  height: number;
  rotation: number;
  transform: AffineMatrix;
  viewBox: ViewBox;
  userUnit: number;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function normalizedToScreen(rect: Rect, pageSize: PageSize, scale: number, dpr = 1): Rect {
  return {
    x: rect.x * pageSize.w * scale * dpr,
    y: rect.y * pageSize.h * scale * dpr,
    w: rect.w * pageSize.w * scale * dpr,
    h: rect.h * pageSize.h * scale * dpr
  };
}

export function screenToNormalized(
  rect: Rect,
  pageSize: PageSize,
  scale: number,
  dpr = 1,
  options?: RectClampOptions
): Rect {
  const x = rect.x / (pageSize.w * scale * dpr);
  const y = rect.y / (pageSize.h * scale * dpr);
  const w = rect.w / (pageSize.w * scale * dpr);
  const h = rect.h / (pageSize.h * scale * dpr);
  return clampRect({ x, y, w, h }, options);
}

export function normalizedToPdf(rect: Rect, pageSize: PageSize): Rect {
  return {
    x: rect.x * pageSize.w,
    y: (1 - rect.y - rect.h) * pageSize.h,
    w: rect.w * pageSize.w,
    h: rect.h * pageSize.h
  };
}

export function pdfToNormalized(rect: Rect, pageSize: PageSize): Rect {
  return clampRect({
    x: rect.x / pageSize.w,
    y: 1 - (rect.y + rect.h) / pageSize.h,
    w: rect.w / pageSize.w,
    h: rect.h / pageSize.h
  });
}

export function clampRect(rect: Rect, options: RectClampOptions = {}): Rect {
  const minW = Math.min(1, Math.max(0, options.minW ?? 0));
  const minH = Math.min(1, Math.max(0, options.minH ?? 0));
  const w = Math.min(1, Math.max(minW, rect.w));
  const h = Math.min(1, Math.max(minH, rect.h));
  return {
    x: clamp01(Math.min(rect.x, 1 - w)),
    y: clamp01(Math.min(rect.y, 1 - h)),
    w,
    h
  };
}

/** Inverts the page's scale-1 viewport transform. The stored transform already includes UserUnit, so the inverse yields PDF user-space units directly. */
export function pdfPointFromViewer(x: number, y: number, geometry: PageGeometry): { x: number; y: number } {
  const [a, b, c, d, e, f] = geometry.transform;
  const det = a * d - b * c;
  if (det === 0) {
    throw new Error('degenerate page transform');
  }
  const px = x - e;
  const py = y - f;
  // + 0 normalizes -0 so downstream serialization and assertions see 0.
  return {
    x: (d * px - c * py) / det + 0,
    y: (a * py - b * px) / det + 0
  };
}

function viewerDirectionToPdf(x: number, y: number, geometry: PageGeometry): { x: number; y: number } {
  const [a, b, c, d] = geometry.transform;
  const det = a * d - b * c;
  return {
    x: (d * x - c * y) / det,
    y: (a * y - b * x) / det
  };
}

/**
 * Maps a normalized placement rectangle (viewer coordinates, origin top-left)
 * into an axis-aligned PDF user-space rectangle plus the content rotation that
 * keeps the drawn content upright on screen. Valid for right-angle page rotations.
 */
export function viewerRectToPdf(rect: Rect, geometry: PageGeometry): { rect: Rect; rotation: number } {
  const x0 = rect.x * geometry.width;
  const y0 = rect.y * geometry.height;
  const x1 = (rect.x + rect.w) * geometry.width;
  const y1 = (rect.y + rect.h) * geometry.height;

  const corners = [
    pdfPointFromViewer(x0, y0, geometry),
    pdfPointFromViewer(x1, y0, geometry),
    pdfPointFromViewer(x0, y1, geometry),
    pdfPointFromViewer(x1, y1, geometry)
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  const right = viewerDirectionToPdf(1, 0, geometry);
  const rotation = ((Math.atan2(right.y, right.x) * 180) / Math.PI + 360) % 360;

  return {
    rect: {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY
    },
    rotation: Math.round(rotation)
  };
}
