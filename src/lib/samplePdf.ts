let cachedBytes: Uint8Array | null = null;

export async function getSamplePdfBytes(): Promise<ArrayBuffer> {
  if (cachedBytes) {
    return cachedBytes.slice().buffer;
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawText('SignLite sample PDF', {
    x: 72,
    y: 700,
    size: 28,
    font,
    color: rgb(0.07, 0.09, 0.15)
  });

  page.drawText('Local pdf.js render verification — no network requests required.', {
    x: 72,
    y: 664,
    size: 14,
    font,
    color: rgb(0.25, 0.3, 0.38)
  });

  page.drawRectangle({
    x: 72,
    y: 500,
    width: 220,
    height: 96,
    color: rgb(0.15, 0.39, 0.92),
    opacity: 0.12,
    borderColor: rgb(0.15, 0.39, 0.92),
    borderWidth: 1.5
  });

  page.drawText('PDF assets bundled locally', {
    x: 92,
    y: 548,
    size: 16,
    font,
    color: rgb(0.07, 0.09, 0.15)
  });

  page.drawText('Worker, cmaps, and standard fonts stay on-device.', {
    x: 92,
    y: 524,
    size: 12,
    font,
    color: rgb(0.25, 0.3, 0.38)
  });

  cachedBytes = await pdfDoc.save();
  return cachedBytes.slice().buffer;
}
