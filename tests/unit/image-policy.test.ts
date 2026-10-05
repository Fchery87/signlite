import { describe, expect, it } from 'vitest';
import {
  dimensionsExceedProcessingCaps,
  MAX_EDGE_PIXELS,
  MAX_PIXEL_AREA,
  normalizedUploadDimensions
} from '../../src/lib/imagePolicy';

describe('image processing policy', () => {
  it('accepts dimensions inside the caps', () => {
    expect(dimensionsExceedProcessingCaps({ width: 4000, height: 4000 })).toBe(false);
    expect(dimensionsExceedProcessingCaps({ width: MAX_EDGE_PIXELS, height: 1000 })).toBe(false);
    expect(dimensionsExceedProcessingCaps({ width: 3900, height: 4000 })).toBe(false);
  });

  it('rejects beyond one edge or the pixel area', () => {
    expect(dimensionsExceedProcessingCaps({ width: MAX_EDGE_PIXELS + 1, height: 10 })).toBe(true);
    expect(dimensionsExceedProcessingCaps({ width: 10, height: MAX_EDGE_PIXELS + 1 })).toBe(true);
    expect(dimensionsExceedProcessingCaps({ width: MAX_EDGE_PIXELS, height: MAX_EDGE_PIXELS })).toBe(true);
  });

  it('normalizes uploads down without changing aspect ratio and never scales up', () => {
    expect(normalizedUploadDimensions({ width: 800, height: 400 })).toEqual({ width: 800, height: 400 });
    const wide = normalizedUploadDimensions({ width: 9000, height: 3000 });
    expect(wide.width).toBeLessThanOrEqual(MAX_EDGE_PIXELS);
    expect(wide.height).toBeLessThanOrEqual(MAX_EDGE_PIXELS);
    expect(wide.width / wide.height).toBeCloseTo(3, 1);
    const huge = normalizedUploadDimensions({ width: 10000, height: 10000 });
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_PIXEL_AREA);
    expect(huge.width).toEqual(huge.height);
  });
});
