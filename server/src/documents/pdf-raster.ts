// Render PDF pages to PNG images so an image-only vision model (Llama, etc.)
// can read them. Broker Rate Cons and many BOLs arrive as PDFs, but
// OpenAI-compatible vision endpoints only accept images — so we rasterize the
// first few pages and hand those over.
//
// WHY A WORKER POOL
// PDF page rendering is CPU-heavy and synchronous enough to block Node's single
// event loop. On a busy server that would stall EVERY other request while one
// PDF renders. So rasterization runs in a small pool of persistent worker
// threads: the main thread stays free to serve requests, and each worker loads
// the mupdf WASM module once and reuses it across jobs.
//
// ISOLATION NOTE: a job carries only the raw PDF bytes in and image bytes out —
// no account identity ever enters a worker, so there is nothing that could cross
// between drivers here. Ownership stays entirely in the request/DB layer.
//
// FAIL-SAFE: any failure (missing native dep, encrypted/malformed PDF, render
// error, timeout) resolves to an empty array so the caller falls back to the
// PDF-native reader (Claude) instead of crashing the scan.

import { Worker } from 'worker_threads';
import * as os from 'os';

// The worker body runs as CommonJS (eval), so there is no .ts/.js build-path to
// resolve — it works identically under ts-node (dev) and compiled dist (prod).
//
// RENDERER: mupdf is a single pure-WASM package with NO native or optional
// dependencies (no node-canvas / Cairo / Pango, no prebuilt binaries). That
// keeps `npm ci` lock-sync trivial and the Railway build free of native
// compilation — the reason we moved off pdfjs-dist + @napi-rs/canvas. mupdf
// loads its WASM once, then renders one job per message.
const WORKER_SRC = `
const { parentPort } = require('worker_threads');
let mupdf = null;

async function ensure() {
  if (mupdf) return;
  mupdf = await import('mupdf');
}

parentPort.on('message', async (msg) => {
  const { id, data, maxPages } = msg;
  try {
    await ensure();
    const uint8 = new Uint8Array(data);
    const doc = mupdf.Document.openDocument(uint8, 'application/pdf');
    const pageCount = Math.min(maxPages, doc.countPages() || 1);
    const out = [];
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      // Scale so the rendered page is ~1600px on its long edge (cap 2.5x): big
      // enough for the vision model to read fine print, small enough to keep the
      // base64 payload reasonable. Page bounds are [x0, y0, x1, y1] in points.
      const b = page.getBounds();
      const w = Math.abs(b[2] - b[0]) || 612;
      const scale = Math.min(2.5, Math.max(1, 1600 / w));
      const matrix = mupdf.Matrix.scale(scale, scale);
      const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pix.asPNG();
      out.push('data:image/png;base64,' + Buffer.from(png).toString('base64'));
      if (pix.destroy) pix.destroy();
      if (page.destroy) page.destroy();
    }
    if (doc.destroy) doc.destroy();
    parentPort.postMessage({ id, ok: true, images: out });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e) });
  }
});
`;

const JOB_TIMEOUT_MS = 25_000;

interface PendingJob {
  resolve: (images: string[]) => void;
  timer: NodeJS.Timeout;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  jobId: number | null;
}

class RasterPool {
  private workers: PooledWorker[] = [];
  private queue: { id: number; data: Buffer; maxPages: number }[] = [];
  private pending = new Map<number, PendingJob>();
  private jobSeq = 0;
  private readonly size: number;
  private disabled = false;

  constructor() {
    // Leave a core for the main thread; keep at least one worker, cap at 4 so a
    // tiny instance can't oversubscribe. Overridable via env for bigger boxes.
    const envSize = Number(process.env.PDF_RASTER_WORKERS);
    const cpuBased = Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1));
    this.size = Number.isFinite(envSize) && envSize > 0 ? envSize : cpuBased;
  }

  rasterize(data: Buffer, maxPages: number): Promise<string[]> {
    if (this.disabled) return Promise.resolve([]);
    return new Promise<string[]>((resolve) => {
      const id = ++this.jobSeq;
      const timer = setTimeout(() => this.onTimeout(id), JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.queue.push({ id, data, maxPages });
      this.pump();
    });
  }

  private ensureWorkers() {
    while (this.workers.length < this.size) {
      try {
        const worker = new Worker(WORKER_SRC, { eval: true });
        const pw: PooledWorker = { worker, busy: false, jobId: null };
        worker.on('message', (m: any) => this.onMessage(pw, m));
        worker.on('error', () => this.onWorkerDown(pw));
        worker.on('exit', () => this.onWorkerDown(pw));
        this.workers.push(pw);
      } catch {
        // Can't spawn workers at all (unlikely) — disable and let callers fall
        // back to the PDF-native reader.
        if (this.workers.length === 0) this.disabled = true;
        break;
      }
    }
  }

  private pump() {
    if (this.disabled) {
      // Drain any queued jobs to the fallback.
      for (const job of this.queue.splice(0)) this.settle(job.id, []);
      return;
    }
    this.ensureWorkers();
    for (const pw of this.workers) {
      if (pw.busy) continue;
      const job = this.queue.shift();
      if (!job) break;
      pw.busy = true;
      pw.jobId = job.id;
      pw.worker.postMessage({
        id: job.id,
        data: job.data,
        maxPages: job.maxPages,
      });
    }
  }

  private onMessage(pw: PooledWorker, m: any) {
    pw.busy = false;
    pw.jobId = null;
    if (m && typeof m.id === 'number') {
      this.settle(m.id, m.ok && Array.isArray(m.images) ? m.images : []);
    }
    this.pump();
  }

  private onWorkerDown(pw: PooledWorker) {
    // Reject the in-flight job (fall back), drop the dead worker, respawn later.
    if (pw.jobId != null) this.settle(pw.jobId, []);
    this.workers = this.workers.filter((w) => w !== pw);
    try {
      pw.worker.terminate();
    } catch {
      /* already gone */
    }
    this.pump();
  }

  private onTimeout(id: number) {
    // A stuck render must not hang the request. Kill the worker handling it so a
    // fresh one replaces it, and fall this job back.
    const pw = this.workers.find((w) => w.jobId === id);
    if (pw) this.onWorkerDown(pw);
    else this.settle(id, []);
  }

  private settle(id: number, images: string[]) {
    const job = this.pending.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    this.pending.delete(id);
    job.resolve(images);
  }
}

let pool: RasterPool | null = null;

export async function rasterizePdf(
  data: Buffer,
  maxPages = 3,
): Promise<string[]> {
  try {
    if (!pool) pool = new RasterPool();
    return await pool.rasterize(data, maxPages);
  } catch {
    return [];
  }
}
