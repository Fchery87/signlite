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
