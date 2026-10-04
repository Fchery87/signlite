import { clampRect, normalizedToPdf, normalizedToScreen, pdfToNormalized, pdfPointFromViewer, screenToNormalized, viewerRectToPdf } from '../../src/pdf/coords';
import type { PageGeometry, Rect } from '../../src/pdf/coords';

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

describe('page geometry transform', () => {
  const matrix = (a: number, b: number, c: number, d: number, e: number, f: number) =>
    [a, b, c, d, e, f] as [number, number, number, number, number, number];

  it('maps viewer corners and center to pdf user space on an unrotated page with a nonzero MediaBox origin', () => {
    // view [50,50,650,850]: T = [1,0,0,-1,-50,850] per the installed PDF.js PageViewport
    const geometry: PageGeometry = {
      width: 600,
      height: 800,
      rotation: 0,
      transform: matrix(1, 0, 0, -1, -50, 850),
      viewBox: { x: 50, y: 50, w: 600, h: 800 },
      userUnit: 1
    };
    const placement: Rect = { x: 0.25, y: 0.25, w: 0.2, h: 0.1 };

    const mapped = viewerRectToPdf(placement, geometry);
    // viewer rect: (150,200)-(270,280); pdf: x = X+50, y = 850-Y
    expect(mapped.rect).toEqual({ x: 200, y: 570, w: 120, h: 80 });
    expect(mapped.rotation).toBe(0);

    const center = pdfPointFromViewer(210, 220, geometry);
    expect(center).toEqual({ x: 260, y: 630 });
  });

  it('inverts a 90-degree rotated cropped page', () => {
    // view [10,20,180,360], rotation 90: W=340, H=170, T = [0,1,1,0,-20,-10]
    const geometry: PageGeometry = {
      width: 340,
      height: 170,
      rotation: 90,
      transform: matrix(0, 1, 1, 0, -20, -10),
      viewBox: { x: 10, y: 20, w: 170, h: 340 },
      userUnit: 1
    };
    const placement: Rect = { x: 0.25, y: 0.25, w: 0.2, h: 0.1 };
    // viewer rect (85,42.5)-(153,59.5); forward: X = y_user - 20, Y = x_user - 10
    // corners -> (52.5,105) (52.5,173) (69.5,105) (69.5,173)
    const mapped = viewerRectToPdf(placement, geometry);
    expect(mapped.rect).toEqual({ x: 52.5, y: 105, w: 17, h: 68 });
    expect(mapped.rotation).toBe(90);

    // bottom-left of the on-screen rect is the pdf anchor for content drawn with rotate 90
    expect(pdfPointFromViewer(85, 59.5, geometry)).toEqual({ x: 69.5, y: 105 });
  });

  it('inverts 180- and 270-degree rotations', () => {
    const rotated180: PageGeometry = {
      width: 600,
      height: 800,
      rotation: 180,
      transform: matrix(-1, 0, 0, 1, 600, 0),
      viewBox: { x: 0, y: 0, w: 600, h: 800 },
      userUnit: 1
    };
    expect(pdfPointFromViewer(0, 0, rotated180)).toEqual({ x: 600, y: 0 });
    const mapped180 = viewerRectToPdf({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, rotated180);
    expect(mapped180.rect).toEqual({ x: 180, y: 400, w: 120, h: 160 });
    expect(mapped180.rotation).toBe(180);

    const rotated270: PageGeometry = {
      width: 340,
      height: 170,
      rotation: 270,
      transform: matrix(0, -1, -1, 0, 340, 170),
      viewBox: { x: 0, y: 0, w: 170, h: 340 },
      userUnit: 1
    };
    // viewer (0,0) -> user (170,340): with 270-degree clockwise rotation the
    // screen top-left is the user-space top-right.
    expect(pdfPointFromViewer(0, 0, rotated270)).toEqual({ x: 170, y: 340 });
    expect(viewerRectToPdf({ x: 0, y: 0, w: 1, h: 1 }, rotated270).rotation).toBe(270);
  });

  it('scales user-space output by UserUnit', () => {
    // userUnit 2: viewer units are physical pt; user-space units = viewer / 2
    // T = [2,0,0,-2,0,300]: viewer canvas is 400x300 physical pt over a 200x150 user-space page
    const geometry: PageGeometry = {
      width: 400,
      height: 300,
      rotation: 0,
      transform: matrix(2, 0, 0, -2, 0, 300),
      viewBox: { x: 0, y: 0, w: 200, h: 150 },
      userUnit: 2
    };
    // viewer (0,0) -> user top-left (0,150); canvas bottom-left is the user origin
    expect(pdfPointFromViewer(0, 300, geometry)).toEqual({ x: 0, y: 0 });
    expect(pdfPointFromViewer(0, 0, geometry)).toEqual({ x: 0, y: 150 });
    const mapped = viewerRectToPdf({ x: 0, y: 0, w: 1, h: 1 }, geometry);
    expect(mapped.rect).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });
});
