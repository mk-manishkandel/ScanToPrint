import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, formatBytes, liveEvents, STATUS_LABEL, type Job, type PrintItem, type PrintPlan, type PrinterOption, type ShopInfo,
} from "../api";
import { PrintOptions } from "../components/PrintOptions";
import { Badge, Button, Card, ErrorText, Input, Spinner } from "../components/ui";

const STORE_KEY = "stp_job";
type Saved = { id: number; token: string };

function loadSaved(): Saved | null {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function save(v: Saved | null) {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode */
  }
}

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff,.heic,.heif,.doc,.docx,.odt,.rtf,.txt,.csv,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.pps,.ppsx,image/*,application/pdf";

export default function CustomerApp() {
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [saved, setSaved] = useState<Saved | null>(loadSaved);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ShopInfo>("/api/shop").then(setShop, (e) => setError(e.message));
  }, []);

  const headers = saved ? { "X-Job-Token": saved.token } : undefined;

  const refresh = useCallback(async () => {
    if (!saved) return;
    try {
      setJob(await api.get<Job>(`/api/jobs/${saved.id}`, { "X-Job-Token": saved.token }));
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        save(null);
        setSaved(null);
        setJob(null);
      }
    }
  }, [saved]);

  useEffect(() => {
    refresh();
    if (!saved) return;
    return liveEvents(`/ws/job/${saved.id}?t=${saved.token}`, () => refresh(), refresh);
  }, [saved, refresh]);

  // Safety net while files convert (in case the websocket is blocked).
  useEffect(() => {
    if (!job?.files.some((f) => f.conversion_status === "pending")) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [job, refresh]);

  const startOver = () => {
    save(null);
    setSaved(null);
    setJob(null);
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-6">
      <header className="mb-6">
        <div className="text-sm font-medium uppercase tracking-wide text-brand-700">ScanToPrint</div>
        <h1 className="text-2xl font-bold">{shop?.shop_name ?? " "}</h1>
      </header>
      <ErrorText error={error} />
      {!job || job.status === "uploaded" ? (
        <UploadStep
          shop={shop}
          job={job}
          headers={headers}
          onCreated={(s) => {
            save(s);
            setSaved(s);
          }}
          onJob={setJob}
        />
      ) : (
        <StatusStep job={job} currency={shop?.currency ?? ""} onNew={startOver} />
      )}
    </div>
  );
}

function UploadStep({
  shop, job, headers, onCreated, onJob,
}: {
  shop: ShopInfo | null;
  job: Job | null;
  headers?: Record<string, string>;
  onCreated: (s: Saved) => void;
  onJob: (j: Job) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<null | "submit" | "self">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list);
    const max = (shop?.max_file_mb ?? 50) * 1024 * 1024;
    const tooBig = files.find((f) => f.size > max);
    if (tooBig) return setError(`"${tooBig.name}" is larger than ${shop?.max_file_mb} MB`);
    try {
      let id = job?.id;
      let token = headers?.["X-Job-Token"];
      if (!id || !token) {
        const created = await api.post<{ id: number; token: string }>("/api/jobs", {
          customer_name: name || null,
          customer_phone: phone || null,
        });
        id = created.id;
        token = created.token;
        onCreated({ id, token });
      }
      setProgress(0);
      onJob(await uploadWithProgress(id, token, files, setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(fid: number) {
    if (!job || !headers) return;
    try {
      onJob(await api.del<Job>(`/api/jobs/${job.id}/files/${fid}`, headers));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const files = job?.files ?? [];
  const converting = files.some((f) => f.conversion_status === "pending");
  const printable = files.filter((f) => f.conversion_status === "ok");

  return (
    <div className="space-y-5">
      {!job && (
        <Card className="space-y-3">
          <p className="text-slate-600">Send your documents straight to the shop's printer. No email or WhatsApp needed.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </Card>
      )}

      <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <button
        type="button"
        disabled={progress !== null}
        onClick={() => fileInput.current?.click()}
        className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-brand-50 px-4 py-8 text-brand-800 active:bg-brand-100"
      >
        <span className="text-4xl">＋</span>
        <span className="mt-1 text-lg font-semibold">{files.length ? "Add more files" : "Choose files to print"}</span>
        <span className="text-xs text-brand-700">PDF, photos, Word, Excel, PowerPoint · up to {shop?.max_file_mb ?? 50} MB each</span>
      </button>

      {progress !== null && (
        <div>
          <div className="mb-1 text-sm text-slate-600">Uploading… {progress}%</div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <ErrorText error={error} />

      {files.length > 0 && (
        <Card className="divide-y divide-slate-100 !p-0">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.original_name}</div>
                <div className="text-xs text-slate-500">
                  {formatBytes(f.size_bytes)}
                  {f.conversion_status === "ok" && ` · ${f.page_count} page${f.page_count === 1 ? "" : "s"}`}
                  {f.conversion_status === "pending" && " · preparing…"}
                </div>
                {f.error && <div className="mt-0.5 text-xs text-amber-700">{f.error}</div>}
              </div>
              {f.conversion_status === "pending" && <Spinner className="h-4 w-4 text-brand-600" />}
              {f.conversion_status === "ok" && job && headers && (
                <a className="text-sm font-medium text-brand-700" target="_blank" rel="noreferrer" href={`/api/jobs/${job.id}/files/${f.id}/pdf?t=${headers["X-Job-Token"]}`}>
                  View
                </a>
              )}
              <button className="px-2 text-lg text-slate-400" aria-label="Remove" onClick={() => remove(f.id)}>✕</button>
            </div>
          ))}
        </Card>
      )}

      {files.length > 0 && !mode && (
        <div className="grid gap-3">
          <Button className="!py-4 text-base" disabled={converting} onClick={() => setMode("submit")}>
            Submit to shop for printing
          </Button>
          <Button variant="secondary" className="!py-4 text-base" disabled={converting || !printable.length} onClick={() => setMode("self")}>
            Print it myself
          </Button>
          {converting && <p className="text-center text-xs text-slate-500">Preparing your files…</p>}
        </div>
      )}

      {mode === "submit" && job && headers && <SubmitSheet job={job} token={headers["X-Job-Token"]} onClose={() => setMode(null)} onJob={onJob} />}
      {mode === "self" && job && headers && <SelfPrintSheet job={job} token={headers["X-Job-Token"]} onClose={() => setMode(null)} onJob={onJob} />}
    </div>
  );
}

function SubmitSheet({ job, token, onClose, onJob }: { job: Job; token: string; onClose: () => void; onJob: (j: Job) => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Submit to shop" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">The shop will print your files. Tell them anything special:</p>
      <textarea
        className="h-28 w-full rounded-lg border border-slate-300 p-3 text-base"
        placeholder="e.g. 2 copies, colour, stapled, spiral binding…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <ErrorText error={error} />
      <Button
        className="mt-4 w-full !py-4 text-base"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            onJob(await api.post<Job>(`/api/jobs/${job.id}/submit`, { notes }, { "X-Job-Token": token }));
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send to shop"}
      </Button>
    </Sheet>
  );
}

function SelfPrintSheet({ job, token, onClose, onJob }: { job: Job; token: string; onClose: () => void; onJob: (j: Job) => void }) {
  const [printers, setPrinters] = useState<PrinterOption[] | null>(null);
  const [state, setState] = useState<{ body: { printer_id: number; items: PrintItem[] } | null; plan: PrintPlan | null }>({ body: null, plan: null });
  const [step, setStep] = useState<"options" | "pay">("options");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = { "X-Job-Token": token };

  useEffect(() => {
    api.get<PrinterOption[]>("/api/printers/available").then(setPrinters, (e) => setError(e.message));
  }, []);

  const quote = useCallback((body: unknown) => api.post<PrintPlan>(`/api/jobs/${job.id}/quote`, body, h), [job.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function printNow() {
    if (!state.body) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/jobs/${job.id}/pay`, {}, h); // payment disabled → "skipped"
      onJob(await api.post<Job>(`/api/jobs/${job.id}/self-print`, state.body, h));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={step === "options" ? "Print it myself" : "Payment"} onClose={onClose}>
      {!printers && !error && <Spinner />}
      {printers && step === "options" && (
        <>
          <PrintOptions files={job.files} printers={printers} quote={quote} onChange={setState} />
          <Button className="mt-4 w-full !py-4 text-base" disabled={!state.plan} onClick={() => setStep("pay")}>
            Continue
          </Button>
        </>
      )}
      {step === "pay" && state.plan && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="flex justify-between text-sm">
              <span>Total</span>
              <span className="text-xl font-bold">
                {state.plan.currency} {state.plan.total_price.toFixed(2)}
              </span>
            </div>
            <div className="text-xs text-slate-500">{state.plan.total_sheets} sheets</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Online payment is coming soon. For now, please <b>pay at the counter</b> when you collect your prints.
          </div>
          <ErrorText error={error} />
          <div className="grid grid-cols-3 gap-3">
            <Button variant="secondary" onClick={() => setStep("options")} disabled={busy}>Back</Button>
            <Button className="col-span-2 !py-4 text-base" onClick={printNow} disabled={busy}>
              {busy ? "Sending to printer…" : "Print now"}
            </Button>
          </div>
        </div>
      )}
      {error && step === "options" && <ErrorText error={error} />}
    </Sheet>
  );
}

function StatusStep({ job, currency, onNew }: { job: Job; currency: string; onNew: () => void }) {
  const steps =
    job.mode === "self"
      ? [["queued", "Queued"], ["printing", "Printing"], ["done", "Printed — collect at the printer"]]
      : [["submitted", "Sent to shop"], ["printing", "Printing"], ["ready", "Ready to collect"]];
  const order = ["submitted", "queued", "printing", "ready", "done", "collected"];
  const idx = order.indexOf(job.status);
  const failedRuns = job.runs?.filter((r) => r.status === "failed") ?? [];

  return (
    <div className="space-y-5">
      <Card className="text-center">
        <div className="text-sm text-slate-500">Your job number</div>
        <div className="my-1 text-5xl font-black tracking-wider text-brand-700">{job.code}</div>
        <div className="text-sm text-slate-500">Show this at the counter</div>
      </Card>
      {job.status === "failed" ? (
        <Card className="border-red-200 bg-red-50">
          <div className="font-semibold text-red-800">Something went wrong while printing</div>
          <div className="mt-1 text-sm text-red-700">{failedRuns[0]?.error ?? "Please ask at the counter."}</div>
          <div className="mt-2 text-sm text-red-700">Please show your job number at the counter — staff can reprint it.</div>
        </Card>
      ) : job.status === "cancelled" ? (
        <Card><div className="font-semibold">This job was cancelled by the shop.</div></Card>
      ) : (
        <Card className="space-y-3">
          {steps.map(([key, label]) => {
            const done = order.indexOf(key) <= idx || (key === "done" && job.status === "collected");
            const current = key === job.status;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${done ? "bg-brand-700 text-white" : "bg-slate-200 text-slate-500"}`}>
                  {done ? "✓" : ""}
                </span>
                <span className={current ? "font-semibold" : done ? "" : "text-slate-400"}>{label}</span>
                {current && (job.status === "printing" || job.status === "queued" || job.status === "submitted") && <Spinner className="h-4 w-4 text-brand-600" />}
              </div>
            );
          })}
        </Card>
      )}
      <Card className="space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge tone="teal">{STATUS_LABEL[job.status]}</Badge></div>
        <div className="flex justify-between"><span className="text-slate-500">Files</span><span>{job.files.length}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Pages</span><span>{job.total_pages}</span></div>
        {job.mode === "self" && (
          <div className="flex justify-between"><span className="text-slate-500">Amount</span><span>{currency} {job.estimated_price.toFixed(2)} (pay at counter)</span></div>
        )}
        {job.notes && <div className="pt-2 text-slate-600">“{job.notes}”</div>}
      </Card>
      <Button variant="secondary" className="w-full" onClick={onNew}>Print something else</Button>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="px-2 text-2xl text-slate-400" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function uploadWithProgress(id: number, token: string, files: File[], onProgress: (p: number) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("file", f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/jobs/${id}/files`);
    xhr.setRequestHeader("X-Job-Token", token);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as Job);
      else reject(new Error(data?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check you're on the shop Wi-Fi."));
    xhr.send(form);
  });
}
