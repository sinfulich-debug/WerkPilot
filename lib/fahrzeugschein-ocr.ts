// Browser-only OCR for the Fahrzeugschein photo. The image is read on the user's device and is never
// uploaded or stored. tesseract.js downloads its language file once from a public CDN; that request
// carries no image data.

export const MAX_SCAN_BYTES = 12 * 1024 * 1024;

export function checkScanFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Bitte wähle ein Foto (JPG oder PNG).';
  if (file.size > MAX_SCAN_BYTES) return 'Das Foto ist zu groß (maximal 12 MB).';
  return null;
}

export async function recognizeFahrzeugschein(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('deu');
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
