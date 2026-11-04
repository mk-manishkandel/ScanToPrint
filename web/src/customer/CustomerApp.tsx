import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, Ban, Camera, CheckCircle2, ChevronRight, Clock, Eye, FileUp, Hourglass, PackageCheck,
  Plus, Printer, RotateCcw, Send, ShieldCheck, Store, Trash2, Wallet, XCircle,
} from "lucide-react";
import {
  api, describeRequest, formatBytes, liveEvents, STATUS_LABEL, STATUS_TONE,
  type Job, type JobFile, type PrintPlan, type PrinterOption, type ShopInfo,
} from "../api";
import { PrintOptions, type PrintBody, type PrintState } from "../components/PrintOptions";
import {
  Badge, Button, Card, Chip, ErrorText, Field, FileIcon, IconButton, Input, Logo, Notice, Sheet, Spinner, Steps, Textarea,
} from "../components/ui";

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

  const sent = !!job && job.status !== "uploaded";
  const step = sent ? 2 : job?.files.length ? 1 : 0;

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-[max(4rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3 animate-fade-in">
        <Logo className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">ScanToPrint</div>
          <h1 className="truncate text-2xl font-bold tracking-tight">{shop?.shop_name ?? " "}</h1>
        </div>
      </header>

      <div className="mt-6 mb-6">
        <Steps steps={["Upload", "Options", "Track"]} current={step} />
      </div>

      <ErrorText error={error} />
      {!sent ? (
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
        <StatusStep job={job} token={saved!.token} currency={shop?.currency ?? ""} onNew={startOver} onJob={setJob} />
      )}

      <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-xs text-steel">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-gold" />
        Your files go only to this shop's computer and are deleted automatically.
      </p>
      <p className="mt-2 text-center text-[11px] tabular-nums text-steel/70">ScanToPrint {__APP_VERSION__}</p>
    </div>
  );
}

/* ================================================================== upload */

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
  const cameraInput = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list);
    const max = (shop?.max_file_mb ?? 50) * 1024 * 1024;
    const tooBig = files.find((f) => f.size > max);
    if (tooBig) return setError(`"${tooBig.name}" is larger than ${shop?.max_file_mb} MB.`);
    try {
      let id = job?.id;
      let token = headers?.["X-Job-Token"];
      if (!id || !token) {
        const created = await api.post<{ id: number; token: string }>("/api/jobs", {
          customer_name: name.trim() || null,
          customer_phone: phone.trim() || null,
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
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  async function remove(f: JobFile) {
    if (!job || !headers) return;
    try {
      onJob(await api.del<Job>(`/api/jobs/${job.id}/files/${f.id}`, headers));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const files = job?.files ?? [];
  const converting = files.some((f) => f.conversion_status === "pending");
  const printable = files.filter((f) => f.conversion_status === "ok");
  const uploading = progress !== null;

  return (
    <div className="space-y-5">
      {!job && (
        <Card className="animate-rise">
          <h2 className="text-xl font-bold tracking-tight">Print from your phone</h2>
          <p className="mt-1 text-sm text-frost/75">Upload your files, then send them to the counter or print them yourself.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Your name" hint="Optional">
              <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Phone" hint="Optional">
              <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </Card>
      )}

      <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFiles(e.target.files)} />

      <div className="animate-rise [animation-delay:60ms]">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="group flex w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gold/45 bg-ink px-4 py-8 text-center transition hover:border-gold hover:bg-navy-hover active:bg-navy-hover disabled:cursor-wait disabled:opacity-70"
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold text-midnight transition group-hover:scale-105">
            {files.length ? <Plus aria-hidden className="h-7 w-7" /> : <FileUp aria-hidden className="h-7 w-7" />}
          </span>
          <span className="mt-3 text-lg font-semibold">{files.length ? "Add more files" : "Choose files to print"}</span>
          <span className="mt-1 text-xs text-steel">PDF, photos, Word, Excel, PowerPoint · up to {shop?.max_file_mb ?? 50} MB each</span>
        </button>
        <Button variant="ghost" icon={Camera} className="mt-2 w-full" disabled={uploading} onClick={() => cameraInput.current?.click()}>
          Take a photo of a document
        </Button>
      </div>

      {uploading && (
        <Card className="!p-4" as="section">
          <div className="mb-2 flex items-center justify-between text-sm" aria-live="polite">
            <span className="flex items-center gap-2"><Spinner className="h-4 w-4" label="Uploading" /> Uploading…</span>
            <span className="tabular-nums text-gold">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-midnight" role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gold transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        </Card>
      )}
      <ErrorText error={error} />

      {files.length > 0 && (
        <Card className="!p-2 animate-rise" as="section">
          <h2 className="sr-only">Your files</h2>
          <ul className="divide-y divide-line">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-2 py-2.5">
                <FileIcon name={f.original_name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.original_name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-steel">
                    <span>{formatBytes(f.size_bytes)}</span>
                    <FileStatus f={f} />
                  </div>
                </div>
                {f.conversion_status === "ok" && job && headers && (
                  <a
                    className="grid h-11 w-11 place-items-center rounded-xl text-gold transition hover:bg-navy-hover"
                    aria-label={`Preview ${f.original_name}`}
                    title="Preview"
                    target="_blank"
                    rel="noreferrer"
                    href={`/api/jobs/${job.id}/files/${f.id}/pdf?t=${headers["X-Job-Token"]}`}
                  >
                    <Eye aria-hidden className="h-5 w-5" />
                  </a>
                )}
                <IconButton icon={Trash2} label={`Remove ${f.original_name}`} onClick={() => remove(f)} className="hover:!text-danger" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {files.length > 0 && (
        <section className="space-y-3 animate-rise [animation-delay:80ms]" aria-label="How do you want to print?">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">How do you want to print?</h2>
          <ChoiceCard
            icon={Store}
            title="Send to the counter"
            text="Staff print it for you. Choose colour, copies and more."
            onClick={() => setMode("submit")}
            disabled={converting}
            primary
          />
          <ChoiceCard
            icon={Printer}
            title="Print it myself"
            text="Pick a printer and print right now."
            onClick={() => setMode("self")}
            disabled={converting || !printable.length}
          />
          {converting && (
            <p className="flex items-center justify-center gap-2 text-xs text-steel" aria-live="polite">
              <Spinner className="h-3.5 w-3.5" label="Preparing" /> Preparing your files…
            </p>
          )}
        </section>
      )}

      {mode === "submit" && job && headers && shop && (
        <SubmitSheet shop={shop} job={job} token={headers["X-Job-Token"]} onClose={() => setMode(null)} onJob={onJob} />
      )}
      {mode === "self" && job && headers && (
        <SelfPrintSheet job={job} token={headers["X-Job-Token"]} onClose={() => setMode(null)} onJob={onJob} />
      )}
    </div>
  );
}

function FileStatus({ f }: { f: JobFile }) {
  if (f.conversion_status === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-gold-soft">
        <Spinner className="h-3 w-3" label="Preparing" /> Preparing
      </span>
    );
  if (f.conversion_status === "ok")
    return (
      <span className="inline-flex items-center gap-1 text-frost/80">
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-gold" /> {f.page_count} page{f.page_count === 1 ? "" : "s"}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-gold-soft" title={f.error ?? undefined}>
      <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Staff will open it
    </span>
  );
}

function ChoiceCard({
  icon: Icon, title, text, onClick, disabled, primary,
}: {
  icon: typeof Store;
  title: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-full cursor-pointer items-center gap-4 rounded-3xl p-4 text-left ring-1 transition active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 ${
        primary ? "bg-navy-hover ring-gold/50 hover:ring-gold" : "bg-ink ring-line hover:ring-line-strong hover:bg-navy-hover"
      }`}
    >
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${primary ? "bg-gold text-midnight" : "bg-midnight text-gold ring-1 ring-gold/30"}`}>
        <Icon aria-hidden className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-steel">{text}</span>
      </span>
      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-steel transition group-hover:translate-x-0.5 group-hover:text-gold" />
    </button>
  );
}

/* ================================================================== submit to the counter */

function SubmitSheet({ shop, job, token, onClose, onJob }: { shop: ShopInfo; job: Job; token: string; onClose: () => void; onJob: (j: Job) => void }) {
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<PrintState>({ body: null, plan: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = { "X-Job-Token": token };
  const quote = useCallback((body: PrintBody) => api.post<PrintPlan>(`/api/jobs/${job.id}/estimate`, { items: body.items }, h), [job.id, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasPrintable = job.files.some((f) => f.conversion_status === "ok");

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onJob(await api.post<Job>(`/api/jobs/${job.id}/submit`, { notes, items: state.body?.items ?? [] }, h));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Send to the counter"
      subtitle="Choose how you'd like it printed. Staff will see this."
      onClose={onClose}
      footer={
        <>
          <ErrorText error={error} />
          <Button size="lg" icon={Send} className="mt-3 w-full" loading={busy} disabled={hasPrintable && !state.body} onClick={send}>
            {busy ? "Sending…" : "Send to shop"}
          </Button>
          <p className="mt-2 text-center text-xs text-steel">You pay at the counter when you collect.</p>
        </>
      }
    >
      <div className="space-y-5">
        {hasPrintable && (
          <PrintOptions files={job.files} caps={shop.print_options} quote={quote} onChange={setState} priceLabel="Estimate" />
        )}
        <Field label="Anything else for the shop?" hint="e.g. stapled, spiral binding, cut to size">
          <Textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/* ================================================================== self-print */

function SelfPrintSheet({ job, token, onClose, onJob }: { job: Job; token: string; onClose: () => void; onJob: (j: Job) => void }) {
  const [printers, setPrinters] = useState<PrinterOption[] | null>(null);
  const [state, setState] = useState<PrintState>({ body: null, plan: null });
  const [step, setStep] = useState<"options" | "pay">("options");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = { "X-Job-Token": token };

  useEffect(() => {
    api.get<PrinterOption[]>("/api/printers/available").then(setPrinters, (e) => setError(e.message));
  }, []);

  const quote = useCallback((body: PrintBody) => api.post<PrintPlan>(`/api/jobs/${job.id}/quote`, body, h), [job.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const footer =
    step === "options" ? (
      <Button size="lg" icon={ArrowRight} className="w-full" disabled={!state.plan} onClick={() => setStep("pay")}>
        Review & pay
      </Button>
    ) : (
      <>
        <ErrorText error={error} />
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Button variant="secondary" size="lg" onClick={() => setStep("options")} disabled={busy}>Back</Button>
          <Button size="lg" icon={Printer} className="col-span-2" loading={busy} onClick={printNow}>
            {busy ? "Sending…" : "Print now"}
          </Button>
        </div>
      </>
    );

  return (
    <Sheet title={step === "options" ? "Print it myself" : "Review & pay"} subtitle={step === "options" ? "Step 1 of 2 · Options" : "Step 2 of 2 · Payment"} onClose={onClose} footer={printers?.length ? footer : undefined}>
      {!printers && !error && <div className="grid place-items-center py-10"><Spinner className="h-7 w-7" /></div>}
      {/* Keep options mounted so going Back keeps the customer's choices. */}
      {printers && (
        <div className={step === "options" ? "" : "hidden"}>
          <PrintOptions files={job.files} printers={printers} quote={quote} onChange={setState} />
        </div>
      )}
      {step === "pay" && state.plan && (
        <div className="space-y-4 animate-fade-in">
          <Card className="!bg-midnight">
            <ul className="space-y-2 text-sm">
              {state.plan.items.map((i) => (
                <li key={i.file_id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.file_name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {describeRequest({ ...i, page_range: "" }).map((t) => <Chip key={t}>{t}</Chip>)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{state.plan!.currency} {i.quote.price.toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
              <span className="text-sm text-steel">{state.plan.total_sheets} sheets</span>
              <span className="text-2xl font-bold tabular-nums text-gold">{state.plan.currency} {state.plan.total_price.toFixed(2)}</span>
            </div>
          </Card>
          <Notice icon={Wallet}>
            Online payment is coming soon. For now, please <b>pay at the counter</b> when you collect your prints.
          </Notice>
        </div>
      )}
      {error && step === "options" && <ErrorText error={error} />}
    </Sheet>
  );
}

/* ================================================================== status */

function StatusStep({
  job, token, currency, onNew, onJob,
}: { job: Job; token: string; currency: string; onNew: () => void; onJob: (j: Job) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Same rule as the server: only while nothing has started printing.
  const canCancel =
    ["submitted", "queued"].includes(job.status) && !(job.runs ?? []).some((r) => r.status === "printing" || r.status === "done");

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      onJob(await api.post<Job>(`/api/jobs/${job.id}/cancel`, {}, { "X-Job-Token": token }));
      setConfirming(false);
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  const steps: [string, string, typeof Send][] =
    job.mode === "self"
      ? [["queued", "Queued", Clock], ["printing", "Printing", Printer], ["done", "Printed. Collect at the printer", PackageCheck]]
      : [["submitted", "Sent to the shop", Send], ["printing", "Printing", Printer], ["ready", "Ready to collect", PackageCheck]];
  const order = ["submitted", "queued", "printing", "ready", "done", "collected"];
  const idx = order.indexOf(job.status);
  const failedRuns = job.runs?.filter((r) => r.status === "failed") ?? [];
  const requested = job.files.filter((f) => f.request);

  return (
    <div className="space-y-5">
      <section
        aria-label="Your job number"
        className="relative overflow-hidden rounded-3xl bg-ink p-6 text-center ring-1 ring-gold/40 animate-pop"
      >
        <div className="relative text-xs font-semibold uppercase tracking-[0.2em] text-steel">Your job number</div>
        <div className="relative my-2 text-6xl font-bold tracking-wider tabular-nums text-gold">{job.code}</div>
        <div className="relative text-sm text-frost/80">Show this at the counter</div>
        <div aria-hidden className="relative mx-auto mt-5 flex max-w-60 items-center gap-1.5">
          {Array.from({ length: 14 }).map((_, i) => <span key={i} className="h-1 flex-1 rounded-full bg-line-strong" />)}
        </div>
      </section>

      {job.status === "failed" ? (
        <Card className="!bg-danger/10 !ring-danger/40">
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div>
              <div className="font-semibold text-danger">Something went wrong while printing</div>
              <div className="mt-1 text-sm text-frost/80">{failedRuns[0]?.error ?? "Please ask at the counter."}</div>
              <div className="mt-2 text-sm text-frost/80">Show your job number at the counter. Staff can reprint it.</div>
            </div>
          </div>
        </Card>
      ) : job.status === "cancelled" ? (
        <Card>
          <div className="flex items-center gap-3">
            <Ban aria-hidden className="h-5 w-5 text-steel" />
            <div>
              <div className="font-semibold">This job was cancelled</div>
              <div className="mt-0.5 text-sm text-steel">Nothing will be printed.</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card as="section">
          <h2 className="sr-only">Progress</h2>
          <ol className="relative space-y-5" aria-live="polite">
            {steps.map(([key, label, Icon], i) => {
              const done = order.indexOf(key) <= idx || (key === "done" && job.status === "collected");
              const current = key === job.status;
              return (
                <li key={key} className="relative flex items-center gap-4">
                  {i < steps.length - 1 && (
                    <span aria-hidden className={`absolute left-5 top-11 h-5 w-px ${done ? "bg-gold/60" : "bg-line"}`} />
                  )}
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition ${
                      current && !["ready", "done"].includes(key)
                        ? "bg-midnight text-gold ring-2 ring-gold"
                        : done
                          ? "bg-gold text-midnight"
                          : "bg-midnight text-steel ring-1 ring-line"
                    }`}
                  >
                    {done && !current ? <CheckCircle2 aria-hidden className="h-5 w-5" /> : <Icon aria-hidden className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block ${current ? "font-semibold" : done ? "text-frost/85" : "text-steel"}`}>{label}</span>
                    {current && ["submitted", "queued", "printing"].includes(key) && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-gold-soft">
                        <Hourglass aria-hidden className="h-3 w-3" /> This page updates by itself
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <Card as="section" className="space-y-3 text-sm">
        <h2 className="sr-only">Details</h2>
        <Row label="Status"><Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge></Row>
        <Row label="Files">{job.files.length}</Row>
        <Row label="Pages">{job.total_pages}</Row>
        {job.estimated_price > 0 && (
          <Row label={job.mode === "self" ? "Amount" : "Estimate"}>
            <span className="font-semibold tabular-nums text-gold">{currency} {job.estimated_price.toFixed(2)}</span>
            <span className="ml-1 text-steel">· pay at counter</span>
          </Row>
        )}
        {requested.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            {requested.map((f) => (
              <div key={f.id}>
                <div className="truncate text-frost/90">{f.original_name}</div>
                <div className="mt-1 flex flex-wrap gap-1">{describeRequest(f.request!).map((t) => <Chip key={t}>{t}</Chip>)}</div>
              </div>
            ))}
          </div>
        )}
        {job.notes && <div className="border-t border-line pt-3 text-frost/80">“{job.notes}”</div>}
      </Card>
      {canCancel && (
        <Button variant="danger" icon={XCircle} className="w-full" onClick={() => setConfirming(true)}>Cancel this print</Button>
      )}
      <Button variant="secondary" icon={RotateCcw} className="w-full" onClick={onNew}>Print something else</Button>
      {confirming && (
        <Sheet
          title={`Cancel job ${job.code}?`}
          subtitle="It hasn't been printed yet. The shop won't print it."
          onClose={() => setConfirming(false)}
          footer={
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button>
              <Button variant="danger" icon={XCircle} loading={cancelling} onClick={cancel}>Yes, cancel</Button>
            </div>
          }
        >
          <ErrorText error={cancelError} />
        </Sheet>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-steel">{label}</span>
      <span className="text-right">{children}</span>
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
