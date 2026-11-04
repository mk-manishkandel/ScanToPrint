import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, liveEvents, STATUS_LABEL, STATUS_TONE, timeAgo, type Job, type JobStatus } from "../api";
import { Badge, Button, ErrorText } from "../components/ui";

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
  const [jobs, setJobs] = useState<Job[]>([]);
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

  const groups: [string, Job[]][] = [
    ["Needs attention", jobs.filter((j) => j.status === "submitted" || j.status === "failed")],
    ["Printing", jobs.filter((j) => j.status === "queued" || j.status === "printing")],
    ["Ready to collect", jobs.filter((j) => j.status === "ready")],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Print queue</h1>
        <span className="text-sm text-steel">Updates live · new jobs play a sound</span>
      </div>
      <ErrorText error={error} />
      {jobs.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line-strong p-12 text-center text-steel">
          No jobs right now. New submissions appear here instantly.
        </div>
      )}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-steel">
              {title} ({list.length})
            </h2>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {list.map((j) => (
                <div
                  key={j.id}
                  onMouseEnter={() => highlight.has(j.id) && setHighlight((h) => { const n = new Set(h); n.delete(j.id); return n; })}
                  className={`rounded-2xl bg-ink p-4 ring-1 ${highlight.has(j.id) ? "ring-2 ring-gold" : "ring-line"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl font-black text-gold">{j.code}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{j.customer_name || "Walk-in customer"}</div>
                      <div className="text-xs text-steel">
                        {j.customer_phone && `${j.customer_phone} · `}
                        {timeAgo(j.created_at)} · {j.mode === "self" ? "Self-print" : "Submitted"}
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm">
                    {j.files.map((f) => (
                      <li key={f.id} className="flex justify-between gap-2">
                        <span className="truncate">{f.original_name}</span>
                        <span className={`shrink-0 text-xs ${f.conversion_status === "ok" ? "text-steel" : "text-gold-soft"}`}>
                          {f.conversion_status === "ok" ? `${f.page_count} p` : f.conversion_status === "pending" ? "preparing" : "open manually"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {j.notes && <div className="mt-2 rounded-lg bg-midnight/60 px-3 py-2 text-sm text-gold-soft ring-1 ring-gold/25">“{j.notes}”</div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/admin/jobs/${j.id}`}>
                      <Button>Open & print</Button>
                    </Link>
                    {j.status !== "ready" && <Button variant="secondary" onClick={() => setStatus(j.id, "ready")}>Mark ready</Button>}
                    {j.status === "ready" && <Button variant="secondary" onClick={() => setStatus(j.id, "collected")}>Collected</Button>}
                    <Button variant="ghost" className="!text-danger" onClick={() => confirm(`Cancel job ${j.code}?`) && setStatus(j.id, "cancelled")}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
