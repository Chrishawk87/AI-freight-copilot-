"use client";

import { useRef, useState } from "react";
import {
  ScanLine,
  Camera,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Loader2,
  Link2,
  Receipt,
  Sparkles,
  Download,
  Package,
  ChevronDown,
  Truck,
  Mail,
  Send,
  X,
} from "lucide-react";
import { PageHeader, Loading, ErrorState, money } from "@/components/ui";
import {
  api,
  type FreightDocument,
  type DocType,
  type Booking,
  type DocumentJob,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readOcrKey } from "@/lib/plugins";
import clsx from "clsx";

const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "BOL", label: "Bill of Lading" },
  { id: "POD", label: "Proof of Delivery" },
  { id: "LUMPER", label: "Lumper Receipt" },
  { id: "FUEL", label: "Fuel Receipt" },
  { id: "OTHER", label: "Other" },
];

// Downscale a phone photo before upload — smaller payload, faster extraction.
function fileToDataUrl(file: File, maxW = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(String(reader.result)); // fall back to raw
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function StatusChip({ status }: { status: FreightDocument["status"] }) {
  const map = {
    complete: "bg-success/15 text-success ring-1 ring-success/30",
    needs_review: "bg-warning/15 text-warning ring-1 ring-warning/30",
    captured: "bg-white/10 text-white/70 ring-1 ring-white/20",
  } as const;
  const label = { complete: "Complete", needs_review: "Needs review", captured: "Captured" }[status];
  return <span className={clsx("chip", map[status])}>{label}</span>;
}

export default function DocumentsPage() {
  const { data: docs, loading, error, reload } = useApi(() => api.documents(), []);
  const { data: bookings } = useApi(() => api.bookings(), []);
  const { data: jobs, loading: jobsLoading, reload: reloadJobs } = useApi(
    () => api.documentJobs(),
    [],
  );
  const { data: carrier } = useApi(() => api.carrier(), []);
  const [view, setView] = useState<"jobs" | "all">("jobs");

  function reloadAll() {
    reload();
    reloadJobs();
  }

  const [docType, setDocType] = useState<DocType>("BOL");
  const [linkedBooking, setLinkedBooking] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [active, setActive] = useState<FreightDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setScanning(true);
    setScanError("");
    try {
      const imageData = await fileToDataUrl(file);
      const doc = await api.scanDocument({
        type: docType,
        imageData,
        bookingId: linkedBooking || undefined,
        ocrKey: readOcrKey(),
      });
      setActive(doc);
      reloadAll();
    } catch (err: any) {
      setScanError(err.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function patchActive(patch: Partial<FreightDocument>) {
    setActive((d) => (d ? { ...d, ...patch } : d));
  }

  async function saveCorrections() {
    if (!active) return;
    setSaving(true);
    try {
      const updated = await api.updateDocument(active.id, {
        bolNumber: active.bolNumber,
        proNumber: active.proNumber,
        shipper: active.shipper,
        consignee: active.consignee,
        poNumber: active.poNumber,
        pieceCount: active.pieceCount,
        weightLbs: active.weightLbs,
        shipDate: active.shipDate,
        deliveryDate: active.deliveryDate,
        signaturePresent: active.signaturePresent,
        signedBy: active.signedBy,
      });
      setActive(updated);
      reloadAll();
    } finally {
      setSaving(false);
    }
  }

  async function stageInvoice() {
    if (!active) return;
    setSaving(true);
    try {
      const updated = await api.stageInvoice(active.id);
      setActive(updated);
      reloadAll();
    } finally {
      setSaving(false);
    }
  }

  const bookingOptions: Booking[] = bookings ?? [];

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Snap a BOL or POD at the dock — AI reads it, checks it's signed, matches your load, and stages the invoice. No back-office wait."
      />

      {/* Capture card */}
      <div className="card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {DOC_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setDocType(t.id)}
              className={clsx(
                "chip transition",
                docType === t.id
                  ? "bg-electric/15 text-white ring-1 ring-electric/40"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            {scanning ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-electric" />
                <div className="text-sm font-semibold">Reading your document…</div>
                <div className="text-xs text-white/40">Extracting fields and checking the signature</div>
              </>
            ) : (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-electric/15">
                  <ScanLine className="h-7 w-7 text-electric" />
                </div>
                <div className="text-sm font-semibold">Add your {docType}</div>
                <div className="text-xs text-white/40">Take a photo, or pick a stored image or document (PDF)</div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg bg-electric px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-electric/90"
                  >
                    <Camera className="h-4 w-4" /> Take a photo
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/5"
                  >
                    <FileText className="h-4 w-4" /> Stored image or document
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl bg-white/[0.02] p-4">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-white/50">
              <Link2 className="h-3.5 w-3.5" /> Link to a booked load (optional)
            </label>
            <select
              value={linkedBooking}
              onChange={(e) => setLinkedBooking(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-navy-900 px-3 py-2 text-sm outline-none focus:border-electric/50"
            >
              <option value="">Auto-match / none</option>
              {bookingOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.load.externalId ?? b.load.id.slice(0, 6)} · {b.load.originCity} → {b.load.destCity}
                </option>
              ))}
            </select>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/40">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-electric" />
              Fields are auto-filled by AI. Review anything flagged before you leave the receiver.
            </p>
          </div>
        </div>

        {/* Camera: capture forces the device camera on mobile/tablet. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="hidden"
        />
        {/* Stored: no capture, so the OS offers the gallery / file browser
            (photos AND documents like PDFs). */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={onFile}
          className="hidden"
        />
        {scanError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> {scanError}
          </div>
        )}
      </div>

      {/* Review panel */}
      {active && <ReviewPanel doc={active} onPatch={patchActive} onSave={saveCorrections} onInvoice={stageInvoice} saving={saving} />}

      {/* History — grouped by job, or a flat list of everything */}
      <div className="mb-3 mt-8 flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white/70">
          {view === "jobs" ? "Documents by job" : "All scanned documents"}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-xs">
          <button
            onClick={() => setView("jobs")}
            className={clsx(
              "rounded-md px-3 py-1.5 font-semibold transition",
              view === "jobs" ? "bg-electric/20 text-white" : "text-white/50 hover:text-white/80"
            )}
          >
            By job
          </button>
          <button
            onClick={() => setView("all")}
            className={clsx(
              "rounded-md px-3 py-1.5 font-semibold transition",
              view === "all" ? "bg-electric/20 text-white" : "text-white/50 hover:text-white/80"
            )}
          >
            All documents
          </button>
        </div>
      </div>

      {view === "jobs" ? (
        jobsLoading ? (
          <Loading />
        ) : !jobs || jobs.length === 0 ? (
          <div className="card p-10 text-center text-sm text-white/40">
            <Package className="mx-auto mb-2 h-6 w-6 text-white/30" />
            No jobs yet. Every document you scan collects under its load here.
          </div>
        ) : (
          <div className="grid gap-3">
            {jobs.map((j) => (
              <JobCard
                key={j.jobId}
                job={j}
                onOpenDoc={(d) => setActive(d)}
                activeId={active?.id}
                companyEmail={carrier?.contactEmail || ""}
                emailConnected={!!carrier?.emailConnected}
                canSendEmail={carrier?.canSendEmail ?? !!carrier?.emailConnected}
              />
            ))}
          </div>
        )
      ) : loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : !docs || docs.length === 0 ? (
        <div className="card p-10 text-center text-sm text-white/40">
          <FileText className="mx-auto mb-2 h-6 w-6 text-white/30" />
          Nothing scanned yet. Snap your first BOL above.
        </div>
      ) : (
        <div className="grid gap-2">
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => setActive(d)}
              className={clsx(
                "card flex items-center justify-between gap-3 p-4 text-left transition hover:bg-white/[0.04]",
                active?.id === d.id && "ring-1 ring-electric/40"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5">
                  <ScanLine className="h-5 w-5 text-electric" />
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="chip bg-white/10 text-white/70">{d.type}</span>
                    {d.bolNumber || "—"}
                  </div>
                  <div className="text-xs text-white/50">
                    {d.shipper || "Unknown shipper"} → {d.consignee || "Unknown consignee"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {d.invoiceStatus === "staged" && (
                  <span className="chip bg-electric/15 text-electric">Invoice staged</span>
                )}
                <StatusChip status={d.status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DOC_LABEL: Record<string, string> = {
  BOL: "BOL",
  POD: "POD",
  LUMPER: "Lumper receipt",
  FUEL: "Fuel receipt",
  OTHER: "Document",
};
function docLabel(d: FreightDocument) {
  const name = DOC_LABEL[d.type] || d.type;
  return d.bolNumber ? `${name} #${d.bolNumber}` : name;
}

function JobCard({
  job,
  onOpenDoc,
  activeId,
  companyEmail,
  emailConnected,
  canSendEmail,
}: {
  job: DocumentJob;
  onOpenDoc: (d: FreightDocument) => void;
  activeId?: string;
  companyEmail: string;
  emailConnected: boolean;
  canSendEmail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState("");

  const [emailOpen, setEmailOpen] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState("");
  const [emailErr, setEmailErr] = useState("");

  // Per-document selection — default to every doc in the job. The user can
  // uncheck any to send/download just the ones they want (individually or as
  // a package). An empty selection means "all".
  const [selectedIds, setSelectedIds] = useState<string[]>(
    job.docs.map((d) => d.id),
  );
  const selectedDocs = job.docs.filter((d) => selectedIds.includes(d.id));
  const allSelected = selectedIds.length === job.docs.length;
  const noneSelected = selectedIds.length === 0;
  // Send everything when the whole job is selected (lets "unassigned" work too);
  // otherwise send just the chosen subset.
  const idsForSend = allSelected ? undefined : selectedIds;

  function toggleDoc(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setSent("");
  }

  function saveBlob(pkg: { dataUrl: string; filename: string }) {
    const a = document.createElement("a");
    a.href = pkg.dataUrl;
    a.download = pkg.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadPackage() {
    if (noneSelected) return;
    setDownloading(true);
    setErr("");
    try {
      const pkg = await api.jobPackage(job.jobId, idsForSend);
      saveBlob(pkg);
    } catch (e: any) {
      setErr(e.message || "Could not build the package");
    } finally {
      setDownloading(false);
    }
  }

  // Real send: the backend emails the combined PDF to the recipient using the
  // carrier's OWN connected email account (set up once in Profile → Send email).
  async function sendEmail() {
    setSending(true);
    setEmailErr("");
    setSent("");
    if (noneSelected) {
      setEmailErr("Select at least one document to send.");
      setSending(false);
      return;
    }
    try {
      const res = await api.emailJobPackage(job.jobId, {
        to: to.trim(),
        message: message.trim() || undefined,
        docIds: idsForSend,
      });
      setSent(`Sent to ${res.to}.`);
      setTo("");
      setMessage("");
    } catch (e: any) {
      setEmailErr(e.message || "Could not send the email");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-electric/10">
            <Truck className="h-5 w-5 text-electric" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{job.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/50">
              <span>{job.docCount} doc{job.docCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{job.types.join(", ")}</span>
              {job.needsReview && (
                <span className="chip bg-warning/15 text-warning">Needs review</span>
              )}
              {job.docCount > 0 && job.completeCount === job.docCount && (
                <span className="chip bg-success/15 text-success">All complete</span>
              )}
            </div>
          </div>
          <ChevronDown
            className={clsx("ml-auto h-4 w-4 shrink-0 text-white/40 transition", open && "rotate-180")}
          />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEmailOpen((o) => !o);
              setSent("");
              setEmailErr("");
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/5"
          >
            <Mail className="h-4 w-4" /> Email
          </button>
          <button
            onClick={downloadPackage}
            disabled={downloading || noneSelected}
            className="flex items-center gap-1.5 rounded-lg bg-electric px-3 py-2 text-xs font-semibold text-white shadow-glow transition hover:bg-electric/90 disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {allSelected
              ? "Package PDF"
              : `Download (${selectedIds.length})`}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5" /> {err}
        </div>
      )}

      {emailOpen && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white/70">
              <Mail className="h-3.5 w-3.5 text-electric" />
              {selectedDocs.length === 1
                ? `Email ${docLabel(selectedDocs[0])}`
                : `Email ${selectedDocs.length} documents as one PDF`}
            </div>
            <button onClick={() => setEmailOpen(false)} className="text-white/40 hover:text-white/70">
              <X className="h-4 w-4" />
            </button>
          </div>
          {sent ? (
            <div className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> {sent}
            </div>
          ) : (
            <div className="grid gap-2">
              <div>
                <div className="mb-1 text-[11px] text-white/40">
                  Including {selectedDocs.length} of {job.docs.length}:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {noneSelected ? (
                    <span className="text-[11px] text-warning">
                      Nothing selected — pick documents below.
                    </span>
                  ) : (
                    selectedDocs.map((d) => (
                      <span key={d.id} className="chip bg-white/10 text-white/70">
                        {docLabel(d)}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Recipient email (broker, factoring, office…)"
                className="w-full rounded-lg border border-white/10 bg-navy-900 px-3 py-2 text-sm outline-none focus:border-electric/50"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional note…"
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-navy-900 px-3 py-2 text-sm outline-none focus:border-electric/50"
              />
              {!noneSelected && (
                <button
                  type="button"
                  onClick={() => {
                    const list = selectedDocs.map(docLabel).join(", ");
                    setMessage((m) =>
                      m.includes(list) ? m : `${m ? m + "\n\n" : ""}Attached: ${list}.`,
                    );
                  }}
                  className="self-start text-[11px] font-semibold text-electric hover:underline"
                >
                  + Add document list to note
                </button>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] leading-relaxed text-white/40">
                  {emailConnected
                    ? `Sends the package PDF from ${companyEmail || "your email"} straight to the recipient.`
                    : canSendEmail
                    ? `Sends the package PDF straight to the recipient${companyEmail ? `, with replies going to ${companyEmail}` : ""}.`
                    : "Add your company email in Profile so replies reach you, then send the PDF straight to the recipient."}
                </p>
                <button
                  onClick={sendEmail}
                  disabled={sending || !to.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-electric px-3 py-2 text-xs font-semibold text-white shadow-glow transition hover:bg-electric/90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </button>
              </div>
              {emailErr && (
                <div className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" /> {emailErr}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between px-1 text-[11px] text-white/40">
            <span>Check the documents to send or download</span>
            <button
              type="button"
              onClick={() =>
                setSelectedIds(allSelected ? [] : job.docs.map((d) => d.id))
              }
              className="font-semibold text-electric hover:underline"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          {job.docs.map((d) => (
            <div
              key={d.id}
              className={clsx(
                "flex items-center gap-3 rounded-xl bg-white/[0.02] p-3 transition hover:bg-white/[0.05]",
                activeId === d.id && "ring-1 ring-electric/40"
              )}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(d.id)}
                onChange={() => toggleDoc(d.id)}
                className="h-4 w-4 shrink-0 accent-electric"
                aria-label={`Include ${docLabel(d)}`}
              />
              <button
                onClick={() => onOpenDoc(d)}
                className="flex flex-1 items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="chip bg-white/10 text-white/70">
                    {DOC_LABEL[d.type] || d.type}
                  </span>
                  <span className="font-medium">{d.bolNumber || "—"}</span>
                </div>
                <StatusChip status={d.status} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  missing,
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string) => void;
  type?: string;
  missing?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          "mt-1 w-full rounded-lg border bg-navy-900 px-3 py-2 text-sm outline-none focus:border-electric/50",
          missing ? "border-warning/50" : "border-white/10"
        )}
      />
    </div>
  );
}

function ReviewPanel({
  doc,
  onPatch,
  onSave,
  onInvoice,
  saving,
}: {
  doc: FreightDocument;
  onPatch: (p: Partial<FreightDocument>) => void;
  onSave: () => void;
  onInvoice: () => void;
  saving: boolean;
}) {
  const complete = doc.missingFields.length === 0 && doc.signaturePresent;
  const isMissing = (f: string) => doc.missingFields.includes(f);

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <FileText className="h-4 w-4 text-electric" /> Review extracted fields
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="chip bg-white/10 text-white/60">
            {doc.ocrProvider === "simulated" ? "Simulated read" : `${doc.ocrProvider} · live`}
          </span>
          <span className="chip bg-white/10 text-white/60">{doc.confidence}% confidence</span>
        </div>
      </div>

      {/* Completeness / signature banner */}
      {complete ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success ring-1 ring-success/30">
          <CheckCircle2 className="h-4 w-4" /> All set — signed and complete. Good to leave the dock.
        </div>
      ) : (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning ring-1 ring-warning/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {!doc.signaturePresent && <div>No signature detected — get it signed before you pull off.</div>}
            {doc.missingLabels.length > 0 && <div>Missing: {doc.missingLabels.join(", ")}.</div>}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="BOL #" value={doc.bolNumber} missing={isMissing("bolNumber")} onChange={(v) => onPatch({ bolNumber: v })} />
        <Field label="PRO #" value={doc.proNumber} onChange={(v) => onPatch({ proNumber: v })} />
        <Field label="PO #" value={doc.poNumber} missing={isMissing("poNumber")} onChange={(v) => onPatch({ poNumber: v })} />
        <Field label="Shipper" value={doc.shipper} missing={isMissing("shipper")} onChange={(v) => onPatch({ shipper: v })} />
        <Field label="Consignee" value={doc.consignee} missing={isMissing("consignee")} onChange={(v) => onPatch({ consignee: v })} />
        <Field label="Signed by" value={doc.signedBy} onChange={(v) => onPatch({ signedBy: v })} />
        <Field label="Pieces" value={doc.pieceCount} type="number" onChange={(v) => onPatch({ pieceCount: v ? Number(v) : null })} />
        <Field label="Weight (lbs)" value={doc.weightLbs} type="number" missing={isMissing("weightLbs")} onChange={(v) => onPatch({ weightLbs: v ? Number(v) : null })} />
        <Field label="Ship date" value={doc.shipDate} type="date" onChange={(v) => onPatch({ shipDate: v })} />
        <Field label="Delivery date" value={doc.deliveryDate} type="date" missing={isMissing("deliveryDate")} onChange={(v) => onPatch({ deliveryDate: v })} />
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={doc.signaturePresent}
          onChange={(e) => onPatch({ signaturePresent: e.target.checked })}
          className="h-4 w-4 accent-electric"
        />
        Signature present on the document
      </label>

      {/* Auto-match + invoice */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <div className="text-xs text-white/50">
          {doc.loadId ? (
            <span className="flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-success" /> Matched to a booked load
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-white/40">
              <Link2 className="h-3.5 w-3.5" /> Not linked to a load
            </span>
          )}
          {doc.invoiceStatus === "staged" && doc.invoiceAmount != null && (
            <span className="mt-1 flex items-center gap-1.5 text-electric">
              <Receipt className="h-3.5 w-3.5" /> Invoice staged for {money(doc.invoiceAmount)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/5 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save corrections"}
          </button>
          <button
            onClick={onInvoice}
            disabled={saving || doc.invoiceStatus === "staged"}
            className="flex items-center gap-1.5 rounded-lg bg-electric px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-electric/90 disabled:opacity-60"
          >
            <Receipt className="h-4 w-4" />
            {doc.invoiceStatus === "staged" ? "Invoice staged" : "Stage invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
