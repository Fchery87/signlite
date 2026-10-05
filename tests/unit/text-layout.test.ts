import { describe, expect, it } from 'vitest';
import { EMBEDDED_FONT_FAMILY, findUnsupportedCharacters, layoutText } from '../../src/pdf/textLayout';

describe('layoutText', () => {
  it('keeps a short single line on one line', async () => {
    const layout = await layoutText('Hello', { fontSize: 12, maxWidthPx: 200 });
    expect(layout.lines.map((line) => line.text)).toEqual(['Hello']);
    expect(layout.clipped).toBe(false);
    expect(layout.truncated).toBe(false);
  });

  it('wraps at spaces when the line exceeds the box', async () => {
    const layout = await layoutText('The quick brown fox', { fontSize: 12, maxWidthPx: 60 });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.map((line) => line.text).join(' ')).toBe('The quick brown fox');
  });

  it('breaks a word longer than the box instead of overflowing it', async () => {
    const layout = await layoutText('Extraordinarily', { fontSize: 12, maxWidthPx: 30 });
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) {
      expect(line.widthPx).toBeLessThanOrEqual(30.5);
    }
  });

  it('preserves explicit newlines and interior spacing', async () => {
    const layout = await layoutText('first  spaced\nthird', { fontSize: 12, maxWidthPx: 500 });
    expect(layout.lines.map((line) => line.text)).toEqual(['first  spaced', 'third']);
  });

  it('drops lines that would run past the box bottom and says so', async () => {
    const layout = await layoutText('one\ntwo\nthree\nfour', { fontSize: 12, maxWidthPx: 500, maxHeightPx: 20 });
    // One 14.4 px line fits in 20 px; the rest are truncated.
    expect(layout.lines).toHaveLength(1);
    expect(layout.truncated).toBe(true);
  });

  it('places the first baseline inside the first line box', async () => {
    const layout = await layoutText('x', { fontSize: 12, maxWidthPx: 500 });
    expect(layout.lineHeightPx).toBeCloseTo(14.4, 5);
    expect(layout.firstBaselinePx).toBeGreaterThan(0);
    expect(layout.firstBaselinePx).toBeLessThan(layout.lineHeightPx);
  });

  it('floors tiny font sizes at the 8 point minimum', async () => {
    const small = await layoutText('x', { fontSize: 2, maxWidthPx: 500 });
    const floor = await layoutText('x', { fontSize: 8, maxWidthPx: 500 });
    expect(small.lineHeightPx).toBe(floor.lineHeightPx);
  });
});

describe('script coverage', () => {
  it.each([
    ['Latin', 'Signed & delivered'],
    ['accented Latin', '¿Dónde estás?'],
    ['Greek', 'Σύμβαση'],
    ['Cyrillic', 'Подписано']
  ])('covers %s', async (_label, text) => {
    expect(await findUnsupportedCharacters(text)).toEqual([]);
  });

  it('reports Chinese characters as outside the bundled coverage', async () => {
    expect(await findUnsupportedCharacters('合同')).toEqual(['合', '同']);
  });

  it('reports emoji outside the bundled coverage', async () => {
    expect(await findUnsupportedCharacters('ok 🎉')).toEqual(['🎉']);
  });

  it('names the family both sides draw with', () => {
    // The preview registers a FontFace under this name, so it is part of the
    // preview/export contract rather than a display label.
    expect(EMBEDDED_FONT_FAMILY).toBe('SignLite Text');
  });
});
