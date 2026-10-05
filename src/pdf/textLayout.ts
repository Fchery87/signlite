import fontkit from '@pdf-lib/fontkit';
import { EMBEDDED_FONTS, EMBEDDED_PRIMARY_FONT } from './generated/embeddedFontData';

/** The resolved text model shared by the preview and the export. Both sides
 *  render what this module decides: the same font, the same line breaks, the
 *  same padding, and the same vertical rhythm. */

export type ResolvedLine = { text: string; widthPx: number };

export type TextLayout = {
  lines: ResolvedLine[];
  /** Distance from one line's baseline to the next, in viewer points. */
  lineHeightPx: number;
  /** Distance from the placement box top to the first baseline. */
  firstBaselinePx: number;
  /** Whether any line exceeded the box width and was clipped at the box edge. */
  clipped: boolean;
  /** Whether lines were dropped for exceeding the box height. */
  truncated: boolean;
};

/** Font family both the preview and the export draw with. */
export const EMBEDDED_FONT_FAMILY = 'SignLite Text';

let familyRegistered: Promise<string> | null = null;

/** Registers the bundled bytes as a FontFace so preview DOM text renders with
 *  the exact face the export embeds. Idempotent. */
export function ensureTextFontFamily(): Promise<string> {
  familyRegistered ??= (async () => {
    const bytes = await getEmbeddedFontBytes();
    const face = new FontFace(EMBEDDED_FONT_FAMILY, bytes.buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    return EMBEDDED_FONT_FAMILY;
  })();
  return familyRegistered;
}

export type LayoutOptions = {
  fontSize: number;
  /** Usable width after padding, in viewer points. */
  maxWidthPx: number;
  /** Usable height after padding. Lines that would run past the box bottom are
   *  dropped, with `truncated` set, so long text cannot silently cover an
   *  adjacent field on either side of the layout. */
  maxHeightPx?: number;
};

type FontkitFont = ReturnType<(typeof fontkit)['create']>;

/** Both import statically, so nothing here performs runtime module loading:
 *  the bytes and shaper ride inside the lazily imported flatten chunk rather
 *  than the initial shell, and measurement cannot stall on an import under
 *  fake timers in tests. */
let cachedFont: FontkitFont | null = null;
let cachedBytes: Uint8Array | null = null;

function decodeFontBytes(): Uint8Array {
  cachedBytes ??= Uint8Array.from(atob(EMBEDDED_PRIMARY_FONT.base64), (char) => char.charCodeAt(0));
  return cachedBytes;
}

export function getTextFont(): FontkitFont {
  cachedFont ??= fontkit.create(decodeFontBytes());
  return cachedFont;
}

/** The exact bytes pdf-lib embeds and the preview registers as a FontFace.
 *  Sharing one source is what makes the preview and the exported PDF agree. */
export async function getEmbeddedFontBytes(): Promise<Uint8Array> {
  return decodeFontBytes();
}

/** The bundled export fonts with their hashes, for the license manifest and
 *  receipts. */
export function bundledFontManifest() {
  return EMBEDDED_FONTS.map(({ fileName, sha256 }) => ({ fileName, sha256 }));
}

/** Characters this font cannot draw. The export refuses to run while any
 *  placement contains one, so the failure is a specific pre-export message
 *  rather than a corrupt or silently degraded output. */
export async function findUnsupportedCharacters(text: string): Promise<string[]> {
  const font = getTextFont();
  const unsupported = new Set<string>();
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (!font.hasGlyphForCodePoint(codePoint) || font.glyphForCodePoint(codePoint).id === 0) {
      unsupported.add(char);
    }
  }
  return [...unsupported];
}

/** Width of `text` at `fontSize` in viewer points, from the font's own metrics. */
function measureLine(font: FontkitFont, text: string, fontSize: number) {
  if (text.length === 0) return 0;
  return (font.layout(text).advanceWidth / font.unitsPerEm) * fontSize;
}

/** CSS line boxes place the glyph baseline at half-leading plus the font's
 *  ascent. Reproducing that formula here is what lets the exported baseline sit
 *  within a point of the preview's without either side eyeballing it. */
function firstBaselineOffset(font: FontkitFont, fontSize: number, lineHeightPx: number) {
  const ascent = (font.ascent / font.unitsPerEm) * fontSize;
  const descent = (-font.descent / font.unitsPerEm) * fontSize;
  const halfLeading = (lineHeightPx - (ascent + descent)) / 2;
  return halfLeading + ascent;
}

function breakWord(font: FontkitFont, word: string, fontSize: number, maxWidthPx: number): string[] {
  // A single word longer than the box is broken at the box edge rather than
  // overflowing; the preview clips at the same edge.
  const pieces: string[] = [];
  let current = '';
  for (const char of Array.from(word)) {
    if (measureLine(font, current + char, fontSize) > maxWidthPx && current.length > 0) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

/** Wraps `text` into the lines both the preview and the export will draw.
 *  Interior spacing is preserved (`pre-wrap` semantics): explicit newlines break,
 *  runs of spaces stay, and only wrapping introduces breaks. */
export async function layoutText(text: string, options: LayoutOptions): Promise<TextLayout> {
  const font = getTextFont();
  const fontSize = Math.max(8, options.fontSize);
  const lineHeightPx = fontSize * 1.2;
  const spaceWidth = measureLine(font, ' ', fontSize);

  const lines: ResolvedLine[] = [];
  const push = (lineText: string) => lines.push({ text: lineText, widthPx: measureLine(font, lineText, fontSize) });

  for (const paragraph of text.split('\n')) {
    let current = '';
    let currentWidth = 0;

    const appendWord = (word: string, wordWidth: number) => {
      // The space separator belongs to the join, so a wrap point drops the
      // pending space exactly like pre-wrap does.
      if (current.length > 0 && currentWidth + spaceWidth + wordWidth > options.maxWidthPx) {
        push(current);
        current = '';
        currentWidth = 0;
      }
      const separator = current.length > 0 ? ' ' : '';
      current += separator + word;
      currentWidth += (separator ? spaceWidth : 0) + wordWidth;
    };

    for (const word of paragraph.split(' ')) {
      const wordWidth = measureLine(font, word, fontSize);
      if (wordWidth > options.maxWidthPx) {
        // A word longer than the box breaks at the box edge whether or not a
        // line is already open; the preview clips at the same edge.
        if (current.length > 0) {
          push(current);
          current = '';
          currentWidth = 0;
        }
        for (const piece of breakWord(font, word, fontSize, options.maxWidthPx)) {
          push(piece);
        }
        continue;
      }
      appendWord(word, wordWidth);
    }
    // Always close the paragraph, including empty lines between newlines.
    push(current);
  }

let truncated = false;
  let visible = lines;
  if (options.maxHeightPx !== undefined) {
    const capacity = Math.max(1, Math.floor((options.maxHeightPx + 1) / lineHeightPx));
    if (lines.length > capacity) {
      visible = lines.slice(0, capacity);
      truncated = true;
    }
  }

  return {
    lines: visible,
    lineHeightPx,
    firstBaselinePx: firstBaselineOffset(font, fontSize, lineHeightPx),
    clipped: visible.some((line) => line.widthPx > options.maxWidthPx + 0.5),
    truncated
  };
}

/** Padding shared with the preview's box (`px-2 py-1`), in viewer points. */
export const TEXT_PADDING = { x: 8, y: 4 };
