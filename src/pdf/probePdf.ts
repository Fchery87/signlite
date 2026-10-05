/** A minimal one-page PDF used only to warm the pdf.js worker during the
 *  readiness preflight. Built once from a literal with a correct xref so the
 *  probe never depends on pdf.js's recovery parser. */

export function buildProbePdfBytes(): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>'
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

let cached: Uint8Array | null = null;

export function getProbePdfBytes(): Uint8Array {
  cached ??= buildProbePdfBytes();
  return cached.slice(0);
}
