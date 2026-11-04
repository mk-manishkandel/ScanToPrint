import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BellRing, CheckCircle2, Clock, Inbox, MessageSquareQuote, PackageCheck, Phone, Printer, QrCode, Store, User, X,
  type LucideIcon,
} from "lucide-react";
import { api, describeRequest, liveEvents, STATUS_LABEL, STATUS_TONE, timeAgo, type Job, type JobStatus } from "../api";
import { Badge, Button, Chip, EmptyState, ErrorText, FileIcon, PageHeader } from "../components/ui";

export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.16);
    });
  } catch {
    /* audio blocked until the page is clicked once */
  }
}

export default function Queue() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<number>>(new Set());
  const [, tick] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(() => api.get<Job[]>("/api/admin/jobs?view=active").then(setJobs, (e) => setError(e.message)), []);

  useEffect(() => {
    load();
    const close = liveEvents(
      "/ws/admin",
      (e) => {
        if (e.type === "job_updated" && e.new && e.job_id) {
          beep();
          setHighlight((h) => new Set(h).add(e.job_id!));
        }
        clearTimeout(timer.current);
        timer.current = window.setTimeout(load, 150);
      },
      load,
    );
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      close();
      clearInterval(clock);
    };
  }, [load]);

  async function setStatus(id: number, status: JobStatus) {
    try {
      await api.patch(`/api/admin/jobs/${id}`, { status });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const list = jobs ?? [];
  const groups: [string, LucideIcon, Job[]][] = [
    ["Needs attention", BellRing, list.filter((j) => j.status === "submitted" || j.status === "failed")],
    ["Printing", Printer, list.filter((j) => j.status === "queued" || j.status === "printing")],
    ["Ready to collect", PackageCheck, list.filter((j) => j.status === "ready")],
  ];
  const seen = (id: number) =>
    highlight.has(id) &&
    setHighlight((h) => {
      const n = new Set(h);
      n.delete(id);
      return n;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Inbox}
        title="Print queue"
        description={
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-gold animate-glow" /> Live · new jobs play a sound
          </span>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {groups.map(([title, Icon, g], i) => (
          <div key={title} className="rounded-2xl bg-ink/80 p-4 ring-1 ring-line animate-rise">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-steel" title={title}>
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-gold" />
              <span className="truncate sm:hidden">{["To do", "Printing", "Ready"][i]}</span>
              <span className="hidden truncate sm:inline">{title}</span>
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{jobs ? g.length : "–"}</div>
          </div>
        ))}
      </div>

      <ErrorText error={error} />
      {jobs && list.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="All caught up"
          action={
            <Link to="/admin/qr">
              <Button variant="secondary" icon={QrCode}>Print the QR poster</Button>
            </Link>
          }
        >
          New jobs from customers appear here instantly, with a sound. Put the QR poster at the counter so customers can find you.
        </EmptyState>
      )}

      {groups.map(([title, Icon, g]) =>
        g.length ? (
          <section key={title} aria-label={title}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-steel">
              <Icon aria-hidden className="h-4 w-4" /> {title} <span className="tabular-nums text-frost/60">({g.length})</span>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {g.map((j) => (
                <JobCard key={j.id} job={j} fresh={highlight.has(j.id)} onSeen={() => seen(j.id)} setStatus={setStatus} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

function JobCard({ job: j, fresh, onSeen, setStatus }: { job: Job; fresh: boolean; onSeen: () => void; setStatus: (id: number, s: JobStatus) => void }) {
  return (
    <article
      onMouseEnter={onSeen}
      onFocus={onSeen}
      aria-label={`Job ${j.code}`}
      className={`flex flex-col rounded-3xl bg-ink/90 p-5 ring-1 transition animate-rise ${fresh ? "ring-2 ring-gold animate-glow" : "ring-line hover:ring-line-strong"}`}
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link to={`/admin/jobs/${j.id}`} className="text-3xl font-bold tracking-tight tabular-nums text-gold hover:text-gold-soft">
              {j.code}
            </Link>
            {fresh && <Badge tone="green" dot={false}>New</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-frost/80">
            <span className="inline-flex items-center gap-1"><User aria-hidden className="h-3.5 w-3.5 text-steel" />{j.customer_name || "Walk-in"}</span>
            {j.customer_phone && (
              <a href={`tel:${j.customer_phone}`} className="inline-flex items-center gap-1 hover:text-gold">
                <Phone aria-hidden className="h-3.5 w-3.5 text-steel" />{j.customer_phone}
              </a>
            )}
            <span className="inline-flex items-center gap-1 text-steel"><Clock aria-hidden className="h-3.5 w-3.5" />{timeAgo(j.created_at)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
          <span className="inline-flex items-center gap-1 text-xs text-steel">
            {j.mode === "self" ? <Printer aria-hidden className="h-3 w-3" /> : <Store aria-hidden className="h-3 w-3" />}
            {j.mode === "self" ? "Self-print" : "At counter"}
          </span>
        </div>
      </header>

      <ul className="mt-4 space-y-2">
        {j.files.map((f) => (
          <li key={f.id} className="flex items-start gap-3">
            <FileIcon name={f.original_name} className="!h-9 !w-9" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{f.original_name}</span>
                <span className={`shrink-0 text-xs ${f.conversion_status === "ok" ? "text-steel" : "text-gold-soft"}`}>
                  {f.conversion_status === "ok" ? `${f.page_count} p` : f.conversion_status === "pending" ? "preparing" : "open manually"}
                </span>
              </div>
              {f.request && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {describeRequest(f.request).map((t) => <Chip key={t} accent={t === "Colour"}>{t}</Chip>)}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {j.notes && (
        <div className="mt-4 flex gap-2 rounded-2xl bg-midnight/60 px-3.5 py-3 text-sm text-gold-soft ring-1 ring-gold/25">
          <MessageSquareQuote aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <span>{j.notes}</span>
        </div>
      )}
      {j.status === "failed" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="h-4 w-4" /> Printing failed. Open the job to reprint.
        </div>
      )}

      <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Link to={`/admin/jobs/${j.id}`}>
          <Button icon={Printer}>Open & print</Button>
        </Link>
        {j.status !== "ready" ? (
          <Button variant="secondary" icon={CheckCircle2} onClick={() => setStatus(j.id, "ready")}>Mark ready</Button>
        ) : (
          <Button variant="secondary" icon={PackageCheck} onClick={() => setStatus(j.id, "collected")}>Collected</Button>
        )}
        <Button
          variant="ghost"
          icon={X}
          className="ml-auto !text-danger hover:!bg-danger/10"
          onClick={() => confirm(`Cancel job ${j.code}?`) && setStatus(j.id, "cancelled")}
        >
          Cancel
        </Button>
      </footer>
    </article>
  );
}
