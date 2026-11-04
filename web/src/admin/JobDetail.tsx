import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Clock, Download, ExternalLink, Eye, EyeOff, FolderOpen, MessageSquareQuote, PackageCheck, Phone,
  Printer, RefreshCw, Store, User,
} from "lucide-react";
import {
  api, describeRequest, formatBytes, liveEvents, STATUS_LABEL, STATUS_TONE, type AdminPrinter, type Job, type JobStatus, type PrintPlan,
} from "../api";
import { PrintOptions, type PrintBody, type PrintState } from "../components/PrintOptions";
import { Badge, Button, Card, Chip, ErrorText, FileIcon, IconButton, Sheet, Spinner } from "../components/ui";

const onShopPc = ["localhost", "127.0.0.1"].includes(location.hostname);

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(() => api.get<Job>(`/api/admin/jobs/${id}`).then(setJob, (e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
    return liveEvents("/ws/admin", (e) => e.job_id === Number(id) && load(), load);
  }, [id, load]);

  if (!job) return error ? <ErrorText error={error} /> : <div className="grid place-items-center py-20"><Spinner className="h-7 w-7" /></div>;

  const setStatus = (status: JobStatus) =>
    api.patch<Job>(`/api/admin/jobs/${job.id}`, { status }).then(setJob, (e) => setError(e.message));
  const onPc = (fid: number, action: "open" | "reveal") =>
    api.post(`/api/admin/files/${fid}/${action}`).catch((e) => setError(e.message));
  const canPrint = job.files.some((f) => f.conversion_status === "ok");

  return (
    <div className="space-y-6">
      <Link to="/admin" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gold hover:text-gold-soft">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Back to queue
      </Link>

      <Card className="!p-6 animate-fade-in">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Job</div>
            <div className="text-5xl font-bold tracking-tight tabular-nums text-gold">{job.code}</div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
              <Chip icon={job.mode === "self" ? Printer : Store}>{job.mode === "self" ? "Self-print" : "Sent to counter"}</Chip>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-frost/85">
              <span className="inline-flex items-center gap-1.5"><User aria-hidden className="h-4 w-4 text-steel" />{job.customer_name || "Walk-in customer"}</span>
              {job.customer_phone && (
                <a href={`tel:${job.customer_phone}`} className="inline-flex items-center gap-1.5 hover:text-gold"><Phone aria-hidden className="h-4 w-4 text-steel" />{job.customer_phone}</a>
              )}
              <span className="inline-flex items-center gap-1.5 text-steel"><Clock aria-hidden className="h-4 w-4" />{new Date(job.created_at).toLocaleString()}</span>
            </div>
            {job.estimated_price > 0 && (
              <div className="text-steel">
                {job.mode === "self" ? "Charged" : "Customer estimate"}: <span className="font-semibold tabular-nums text-frost">{job.estimated_price.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" icon={Printer} onClick={() => setPrinting(true)} disabled={!canPrint}>Print…</Button>
            <Button size="lg" variant="secondary" icon={CheckCircle2} onClick={() => setStatus("ready")}>Mark ready</Button>
            <Button size="lg" variant="secondary" icon={PackageCheck} onClick={() => setStatus("collected")}>Collected</Button>
          </div>
        </div>
        {job.notes && (
          <div className="mt-5 flex gap-3 rounded-2xl bg-midnight px-4 py-3 text-gold-soft ring-1 ring-gold/25">
            <MessageSquareQuote aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <div><span className="text-xs uppercase tracking-wider text-steel">Customer note</span><div>{job.notes}</div></div>
          </div>
        )}
      </Card>
      <ErrorText error={error} />

      <div className={`grid items-start gap-6 ${preview ? "xl:grid-cols-2" : ""}`}>
      <section aria-label="Files" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">Files ({job.files.length})</h2>
        <Card className="!p-2">
          <ul className="divide-y divide-line">
            {job.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 p-3">
                <FileIcon name={f.original_name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.original_name}</div>
                  <div className="text-xs text-steel">
                    {formatBytes(f.size_bytes)}
                    {f.page_count ? ` · ${f.page_count} page${f.page_count === 1 ? "" : "s"}` : ""}
                    {f.error && <span className="text-gold-soft"> · {f.error}</span>}
                  </div>
                  {f.request && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-steel">Customer wants:</span>
                      {describeRequest(f.request).map((t) => <Chip key={t} accent={t === "Colour"}>{t}</Chip>)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {f.conversion_status === "ok" && (
                    <IconButton icon={preview === f.id ? EyeOff : Eye} label={preview === f.id ? "Hide preview" : `Preview ${f.original_name}`} onClick={() => setPreview(preview === f.id ? null : f.id)} />
                  )}
                  {f.conversion_status === "failed" && (
                    <IconButton icon={RefreshCw} label="Retry converting" onClick={() => api.post(`/api/admin/files/${f.id}/reconvert`).then(load, (e) => setError(e.message))} />
                  )}
                  {onShopPc && (
                    <>
                      <IconButton icon={ExternalLink} label="Open on this PC" onClick={() => onPc(f.id, "open")} />
                      <IconButton icon={FolderOpen} label="Show in folder" onClick={() => onPc(f.id, "reveal")} />
                    </>
                  )}
                  <a
                    href={`/api/admin/files/${f.id}/original`}
                    aria-label={`Download ${f.original_name}`}
                    title="Download"
                    className="grid h-11 w-11 place-items-center rounded-xl text-steel transition hover:bg-navy-hover hover:text-frost"
                  >
                    <Download aria-hidden className="h-5 w-5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
      {preview && (
        <iframe title="File preview" src={`/api/admin/files/${preview}/pdf`} className="h-[75vh] w-full rounded-3xl bg-deep ring-1 ring-line animate-fade-in xl:sticky xl:top-6 xl:h-[calc(100dvh-3rem)]" />
      )}
      </div>

      {!!job.runs?.length && (
        <section aria-label="Print history" className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">Print history</h2>
          <Card className="overflow-x-auto !p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-steel">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium">File</th>
                  <th className="py-3 font-medium">Printer</th>
                  <th className="py-3 font-medium">Settings</th>
                  <th className="py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {job.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line first:border-0">
                    <td className="max-w-56 truncate px-5 py-3">{job.files.find((f) => f.id === r.file_id)?.original_name}</td>
                    <td className="py-3">{r.printer_name ?? "—"}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {describeRequest({ ...r, page_range: r.page_range ?? "" }).map((t) => <Chip key={t}>{t}</Chip>)}
                      </div>
                    </td>
                    <td className="py-3 capitalize text-steel">{r.triggered_by}</td>
                    <td className="px-5 py-3">
                      <Badge tone={r.status === "done" ? "green" : r.status === "failed" ? "red" : "blue"}>{r.status}</Badge>
                      {r.error && <div className="mt-1 text-xs text-danger">{r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
      {printing && <PrintDialog job={job} onClose={() => setPrinting(false)} onDone={(j) => { setJob(j); setPrinting(false); }} />}
    </div>
  );
}

function PrintDialog({ job, onClose, onDone }: { job: Job; onClose: () => void; onDone: (j: Job) => void }) {
  const [printers, setPrinters] = useState<AdminPrinter[] | null>(null);
  const [state, setState] = useState<PrintState>({ body: null, plan: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<AdminPrinter[]>("/api/admin/printers").then((p) => setPrinters(p.filter((x) => x.is_active)), (e) => setError(e.message));
  }, []);
  const quote = useCallback((body: PrintBody) => api.post<PrintPlan>(`/api/admin/jobs/${job.id}/quote`, body), [job.id]);
  const initial = Object.fromEntries(job.files.map((f) => [f.id, f.request]));
  const fromCustomer = job.files.some((f) => f.request);

  return (
    <Sheet
      wide
      title={`Print job ${job.code}`}
      subtitle={fromCustomer ? "Options are pre-filled with what the customer asked for." : undefined}
      onClose={onClose}
      footer={
        <>
          <ErrorText error={error} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button
              size="lg"
              icon={Printer}
              loading={busy}
              disabled={!state.body}
              onClick={async () => {
                setBusy(true);
                try {
                  onDone(await api.post<Job>(`/api/admin/jobs/${job.id}/print`, state.body));
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sending…" : "Print"}
            </Button>
          </div>
        </>
      }
    >
      {!printers && !error && <div className="grid place-items-center py-10"><Spinner className="h-7 w-7" /></div>}
      {printers && printers.length === 0 && <ErrorText error="No active printers. Turn one on in Printers." />}
      {printers && printers.length > 0 && <PrintOptions files={job.files} printers={printers} initial={initial} quote={quote} onChange={setState} />}
    </Sheet>
  );
}
