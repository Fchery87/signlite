export type PageSize = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type RectClampOptions = { minW?: number; minH?: number };

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
