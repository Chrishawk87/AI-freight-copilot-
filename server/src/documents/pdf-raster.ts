// Render PDF pages to PNG images so an image-only vision model (Llama, etc.)
// can read them. Broker Rate Cons and many BOLs arrive as PDFs, but
// OpenAI-compatible vision endpoints only accept images — so we rasterize the
// first few pages server-side and hand those over.
//
// This is deliberately fail-safe: any problem (missing native dep, an encrypted
// or malformed PDF, a render error) returns an empty array so the caller can
// fall back to a PDF-native reader (Claude) instead of crashing the scan.
//
// The pdfjs + canvas modules are imported through indirect (variable) specifiers
// so the TypeScript compiler doesn't statically resolve them — they're only
// needed at runtime on the server, where npm has installed the prebuilt
// @napi-rs/canvas binary for the deploy platform.

export async function rasterizePdf(
  data: Buffer,
  maxPages = 3,
): Promise<string[]> {
  try {
    // Indirect specifiers keep tsc from resolving these at build time.
    const pdfjsSpec = 'pdfjs-dist/legacy/build/pdf.mjs';
    const canvasSpec = '@napi-rs/canvas';
    const pdfjs: any = await import(pdfjsSpec);
    const canvas: any = await import(canvasSpec);
    const createCanvas = canvas.createCanvas;

    const uint8 = new Uint8Array(data);
    const doc = await pdfjs.getDocument({
      data: uint8,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pageCount = Math.min(maxPages, doc.numPages || 1);
    const out: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      // Scale so the widest side lands near 1600px — enough detail for OCR
      // without bloating the request. Never downscale below the native width.
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, Math.max(1, 1600 / unit.width));
      const viewport = page.getViewport({ scale });

      const cv = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = cv.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const b64 = cv.toBuffer('image/png').toString('base64');
      out.push(`data:image/png;base64,${b64}`);
    }

    return out;
  } catch {
    // Any failure → let the caller fall back to a PDF-native reader.
    return [];
  }
}
