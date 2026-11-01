import { Buffer } from 'node:buffer';

export function createCMapPdf(cmapName = '90ms-RKSJ-H'): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    '<</Length 46>>\nstream\nBT /F1 24 Tf 72 700 Td <9348 967B 82CC> Tj ET\nendstream',
    `<</Type/Font/Subtype/Type0/BaseFont/HeiseiKakuGo-W5/Encoding/${cmapName}/DescendantFonts[6 0 R]>>`,
    '<</Type/Font/Subtype/CIDFontType0/BaseFont/HeiseiKakuGo-W5/CIDSystemInfo<</Registry(Adobe)/Ordering(Japan1)/Supplement 2>>/FontDescriptor 7 0 R/DW 1000>>',
    '<</Type/FontDescriptor/FontName/HeiseiKakuGo-W5/Flags 4/FontBBox[0 -200 1000 900]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 880/StemV 80>>'
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(`${body}${xref}trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1');
}
