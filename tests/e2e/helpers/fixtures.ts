import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Buffer } from 'node:buffer';

export const SAMPLE_UPLOAD_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgYGD4z8DAwMDEAAUAGCUBg0b07W8AAAAASUVORK5CYII=',
  'base64'
);

export async function createSamplePdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawText('SignLite sign-flow fixture', {
    x: 72,
    y: 700,
    size: 24,
    font,
    color: rgb(0.07, 0.09, 0.15)
  });

  page.drawText('Single-document signing should stay local.', {
    x: 72,
    y: 660,
    size: 14,
    font,
    color: rgb(0.25, 0.3, 0.38)
  });

  return Buffer.from(await pdfDoc.save());
}

export async function createBatchPdf(label: string, pages = 2): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = pdfDoc.addPage([612, 792]);
    page.drawText(`${label} — page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 24,
      font,
      color: rgb(0.07, 0.09, 0.15)
    });

    page.drawText('Batch signing should stay local.', {
      x: 72,
      y: 660,
      size: 14,
      font,
      color: rgb(0.25, 0.3, 0.38)
    });
  }

  return Buffer.from(await pdfDoc.save());
}

export async function createPerformancePdf(label: string, pages = 10): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`${label} page ${pageIndex + 1}`, { x: 72, y: 700, size: 18, font });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export function pdfFixture(name: string, buffer: Buffer) {
  return { name, mimeType: 'application/pdf', buffer };
}

/** One-page PDF with MediaBox 200x400, CropBox [10,20,180,360] and /Rotate 90.
 *  The effective preview viewport is 340x170 and pdf.js builds the transform
 *  [0,1,1,0,-20,-10] for it (verified against the installed pdfjs-dist source). */
export async function createRotatedCroppedPdf(): Promise<Buffer> {
  const { degrees, PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 400]);
  page.setCropBox(10, 20, 170, 340);
  page.setRotation(degrees(90));
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/** Effective page geometry for createRotatedCroppedPdf, as captured at intake. */
export const ROTATED_CROPPED_GEOMETRY = {
  width: 340,
  height: 170,
  transform: [0, 1, 1, 0, -20, -10] as [number, number, number, number, number, number]
};

/** A Shift-JIS PDF whose Type0 font encodes with the predefined 90ms-RKSJ-H
 *  CMap. Rendering it forces pdf.js to request that CMap, so this fixture is
 *  the proof that CMaps come from the resident bundle and not the network: a
 *  plain Helvetica fixture never touches the CMap path. */
export async function createCMapPdf(): Promise<Buffer> {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    '<</Length 46>>\nstream\nBT /F1 24 Tf 72 700 Td <9348 967B 82CC> Tj ET\nendstream',
    '<</Type/Font/Subtype/Type0/BaseFont/HeiseiKakuGo-W5/Encoding/90ms-RKSJ-H/DescendantFonts[6 0 R]>>',
    '<</Type/Font/Subtype/CIDFontType0/BaseFont/HeiseiKakuGo-W5/CIDSystemInfo<</Registry(Adobe)/Ordering(Japan1)/Supplement 2>>/FontDescriptor 7 0 R/DW 1000>>',
    '<</Type/FontDescriptor/FontName/HeiseiKakuGo-W5/Flags 4/FontBBox[0 -200 1000 900]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 880/StemV 80>>'
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
  return Buffer.from(body + xref + trailer, 'latin1');
}

/** Intake is gated on the signing runtime being resident; every scenario must
 *  cross this boundary before handing files to the app. */
export async function waitForRuntimeReady(page: import('@playwright/test').Page) {
  const { expect } = await import('@playwright/test');
  await expect(page.getByTestId('runtime-readiness')).toHaveText('Ready to sign offline.', { timeout: 60000 });
}
