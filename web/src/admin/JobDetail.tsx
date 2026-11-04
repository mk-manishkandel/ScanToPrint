import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api, formatBytes, liveEvents, STATUS_LABEL, STATUS_TONE, type AdminPrinter, type Job, type JobStatus, type PrintItem, type PrintPlan,
} from "../api";
import { PrintOptions } from "../components/PrintOptions";
import { Badge, Button, Card, ErrorText, Spinner } from "../components/ui";

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

  if (!job) return error ? <ErrorText error={error} /> : <Spinner />;

  const setStatus = (status: JobStatus) =>
    api.patch<Job>(`/api/admin/jobs/${job.id}`, { status }).then(setJob, (e) => setError(e.message));
  const openOnPc = (fid: number) => api.post(`/api/admin/files/${fid}/open`).catch((e) => setError(e.message));

  return (
    <div className="space-y-5">
      <Link to="/admin" className="text-sm text-gold">← Back to queue</Link>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-4xl font-black text-gold">{job.code}</div>
        <div>
          <div className="font-semibold">{job.customer_name || "Walk-in customer"}</div>
          <div className="text-sm text-steel">
            {job.customer_phone} {new Date(job.created_at).toLocaleString()} · {job.mode === "self" ? "Self-print" : "Submitted for print"}
          </div>
        </div>
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setPrinting(true)} disabled={!job.files.some((f) => f.conversion_status === "ok")}>Print…</Button>
          <Button variant="secondary" onClick={() => setStatus("ready")}>Mark ready</Button>
          <Button variant="secondary" onClick={() => setStatus("collected")}>Collected</Button>
        </div>
      </div>
      {job.notes && <div className="rounded-xl bg-ink px-4 py-3 text-gold-soft ring-1 ring-gold/30">Customer note: “{job.notes}”</div>}
      <ErrorText error={error} />

      <Card className="divide-y divide-line !p-0">
        {job.files.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{f.original_name}</div>
              <div className="text-xs text-steel">
                {formatBytes(f.size_bytes)} {f.page_count ? `· ${f.page_count} page${f.page_count === 1 ? "" : "s"}` : ""}
                {f.error && <span className="text-gold-soft"> · {f.error}</span>}
              </div>
            </div>
            {f.conversion_status === "ok" && (
              <Button variant="secondary" onClick={() => setPreview(preview === f.id ? null : f.id)}>
                {preview === f.id ? "Hide preview" : "Preview"}
              </Button>
            )}
            {f.conversion_status === "failed" && (
              <Button variant="secondary" onClick={() => api.post(`/api/admin/files/${f.id}/reconvert`).then(load, (e) => setError(e.message))}>
                Retry convert
              </Button>
            )}
            {onShopPc && <Button variant="secondary" onClick={() => openOnPc(f.id)}>Open on PC</Button>}
            <a href={`/api/admin/files/${f.id}/original`}>
              <Button variant="secondary">Download</Button>
            </a>
          </div>
        ))}
      </Card>
      {preview && (
        <iframe title="preview" src={`/api/admin/files/${preview}/pdf`} className="h-[75vh] w-full rounded-2xl bg-deep ring-1 ring-line" />
      )}

      {!!job.runs?.length && (
        <Card>
          <h2 className="mb-3 font-semibold">Print history</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-steel">
              <tr><th>File</th><th>Printer</th><th>Settings</th><th>By</th><th>Status</th></tr>
            </thead>
            <tbody>
              {job.runs.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2">{job.files.find((f) => f.id === r.file_id)?.original_name}</td>
                  <td>{r.printer_name ?? "—"}</td>
                  <td>
                    {r.page_range ?? "all"} · {r.copies}× · {r.color ? "colour" : "B/W"} · {r.duplex ? "2-sided" : "1-sided"} · {r.paper_size}
                  </td>
                  <td className="capitalize">{r.triggered_by}</td>
                  <td>
                    <Badge tone={r.status === "done" ? "green" : r.status === "failed" ? "red" : "blue"}>{r.status}</Badge>
                    {r.error && <div className="text-xs text-danger">{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {printing && <PrintDialog job={job} onClose={() => setPrinting(false)} onDone={(j) => { setJob(j); setPrinting(false); }} />}
    </div>
  );
}

function PrintDialog({ job, onClose, onDone }: { job: Job; onClose: () => void; onDone: (j: Job) => void }) {
  const [printers, setPrinters] = useState<AdminPrinter[] | null>(null);
  const [state, setState] = useState<{ body: { printer_id: number; items: PrintItem[] } | null; plan: PrintPlan | null }>({ body: null, plan: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<AdminPrinter[]>("/api/admin/printers").then((p) => setPrinters(p.filter((x) => x.is_active)), (e) => setError(e.message));
  }, []);
  const quote = useCallback((body: unknown) => api.post<PrintPlan>(`/api/admin/jobs/${job.id}/quote`, body), [job.id]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-deep/75 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-ink p-6 shadow-2xl shadow-black/50 ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-xl font-bold">Print job {job.code}</h2>
        {!printers && !error && <Spinner />}
        {printers && printers.length === 0 && <ErrorText error="No active printers. Turn one on in Printers." />}
        {printers && printers.length > 0 && <PrintOptions files={job.files} printers={printers} quote={quote} onChange={setState} />}
        <ErrorText error={error} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!state.body || busy}
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
      </div>
    </div>
  );
}
