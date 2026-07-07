import { clampRect, normalizedToPdf, normalizedToScreen, pdfToNormalized, screenToNormalized } from '../../src/pdf/coords';

describe('coords', () => {
  const page = { w: 612, h: 792 };
  const rect = { x: 0.25, y: 0.3, w: 0.2, h: 0.1 };

  it('round-trips between normalized and pdf coordinates', () => {
    const next = pdfToNormalized(normalizedToPdf(rect, page), page);
    expect(next.x).toBeCloseTo(rect.x);
    expect(next.y).toBeCloseTo(rect.y);
    expect(next.w).toBeCloseTo(rect.w);
    expect(next.h).toBeCloseTo(rect.h);
  });

  it('round-trips between normalized and screen coordinates', () => {
    const next = screenToNormalized(normalizedToScreen(rect, page, 1.5, 2), page, 1.5, 2);
    expect(next.x).toBeCloseTo(rect.x);
    expect(next.y).toBeCloseTo(rect.y);
    expect(next.w).toBeCloseTo(rect.w);
    expect(next.h).toBeCloseTo(rect.h);
  });

  it('clamps rectangles to page bounds', () => {
    expect(clampRect({ x: 0.9, y: 0.95, w: 0.2, h: 0.2 })).toEqual({
      x: 0.8,
      y: 0.8,
      w: 0.2,
      h: 0.2
    });
  });
});
