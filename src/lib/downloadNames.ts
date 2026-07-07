export function stemFromFileName(fileName: string) {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

export function signedPdfFileName(fileName: string) {
  return `${stemFromFileName(fileName)}-signed.pdf`;
}

export function batchZipFileName(date = new Date()) {
  const stamp = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
  return `signlite-batch-${stamp}.zip`;
}

export function dedupeFileName(fileName: string, usedNames: Set<string>) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const stem = stemFromFileName(fileName);
  const extension = fileName.slice(stem.length);
  let index = 2;
  let candidate = `${stem}-${index}${extension}`;

  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${extension}`;
  }

  usedNames.add(candidate);
  return candidate;
}
