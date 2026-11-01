import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/** A self-contained Type0 font with a predefined Shift-JIS CMap. ASCII A/B/C
 * map to Adobe-Japan1 CIDs 264/265/266, then to embedded font glyphs. No installed
 * CJK/system font is needed, so font diagnostics indicate a real regression. */
export async function createCMapPdf(cmapName = '90ms-RKSJ-H'): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile('public/fonts/Caveat-Regular.ttf'));
  const encoded = font.encodeText('ABC').asString();
  await font.embed();
  const fontDict = pdf.context.lookup(font.ref, PDFDict);
  fontDict.set(PDFName.of('Encoding'), PDFName.of(cmapName));
  fontDict.set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.stream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Fixture-UCS def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfchar <41> <0041> <42> <0042> <43> <0043> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')));
  const descendant = fontDict.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const cidToGid = Buffer.alloc(267 * 2);
  for (let index = 0; index < 3; index++) cidToGid.writeUInt16BE(Number.parseInt(encoded.slice(index * 4, index * 4 + 4), 16), (264 + index) * 2);
  descendant.set(PDFName.of('CIDSystemInfo'), pdf.context.obj({ Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Japan1'), Supplement: 2 }));
  descendant.set(PDFName.of('CIDToGIDMap'), pdf.context.register(pdf.context.stream(cidToGid)));
  descendant.set(PDFName.of('W'), pdf.context.obj([264, [700, 700, 700]]));
  const page = pdf.addPage([612, 792]);
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('BT /F1 40 Tf 72 700 Td <414243> Tj ET')));
  return Buffer.from(await pdf.save());
}
