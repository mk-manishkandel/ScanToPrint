import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileStack, Files, Inbox, History as HistoryIcon, Printer, Search, Store, Wallet, X, type LucideIcon } from "lucide-react";
import { api, STATUS_LABEL, STATUS_TONE, type Job } from "../api";
import { Badge, Button, EmptyState, ErrorText, Input, PageHeader, Spinner } from "../components/ui";
import { DatePicker } from "../components/pickers";

export default function History() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ view: "all", q, date, limit: "500" });
      api.get<Job[]>(`/api/admin/jobs?${params}`).then(setJobs, (e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, date]);

  const list = jobs ?? [];
  const pages = list.reduce((s, j) => s + j.total_pages, 0);
  const revenue = list.reduce((s, j) => s + (j.estimated_price || 0), 0);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const money = (n: number) => (n ? n.toFixed(2) : "—");
  const open = (id: number) => navigate(`/admin/jobs/${id}`);

  return (
    <div className="space-y-6">
      <PageHeader icon={HistoryIcon} title="History" description="Every job, newest first. Click a row to open it." />

      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Inbox} label="Jobs" value={jobs ? list.length : "–"} />
        <Stat icon={Files} label="Pages" value={jobs ? pages : "–"} />
        <Stat icon={Wallet} label="Value" value={jobs ? revenue.toFixed(2) : "–"} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative block flex-1">
          <span className="sr-only">Search</span>
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <Input className="!pl-10" placeholder="Search code, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <div className="flex-1 sm:w-52 sm:flex-none">
            <DatePicker label="Date" value={date} onChange={setDate} max={new Date().toLocaleDateString("en-CA")} />
          </div>
          {(q || date) && (
            <Button variant="ghost" icon={X} onClick={() => { setQ(""); setDate(""); }}>Clear</Button>
          )}
        </div>
      </div>

      <ErrorText error={error} />
      {!jobs && !error && <div className="grid place-items-center py-16"><Spinner className="h-7 w-7" /></div>}
      {jobs && list.length === 0 && (
        <EmptyState icon={FileStack} title="No jobs found">{q || date ? "Try a different search or date." : "Jobs appear here once customers start uploading."}</EmptyState>
      )}

      {list.length > 0 && (
        <>
          {/* Wide screens: a table. */}
          <div className="hidden overflow-hidden rounded-2xl bg-ink ring-1 ring-line animate-fade-in md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[24%]" />
                <col className="w-[17%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-midnight text-left text-xs uppercase tracking-wider text-steel">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Code</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Pages</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((j) => (
                  <tr key={j.id} onClick={() => open(j.id)} className="cursor-pointer align-middle transition hover:bg-navy-hover">
                    <td className="px-4 py-3">
                      <Link to={`/admin/jobs/${j.id}`} className="font-bold tabular-nums text-gold hover:text-gold-soft" onClick={(e) => e.stopPropagation()}>
                        {j.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="truncate font-medium">{j.customer_name ?? <span className="font-normal text-steel">Walk-in</span>}</div>
                      {j.customer_phone && <div className="truncate text-xs tabular-nums text-steel">{j.customer_phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="tabular-nums">{fmtDate(j.created_at)}</div>
                      <div className="text-xs tabular-nums text-steel">{fmtTime(j.created_at)}</div>
                    </td>
                    <td className="px-4 py-3"><ModeLabel mode={j.mode} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {j.total_pages}
                      <div className="text-xs text-steel">{j.files.length} {j.files.length === 1 ? "file" : "files"}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(j.estimated_price)}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per job instead of a sideways-scrolling table. */}
          <ul className="space-y-2 md:hidden">
            {list.map((j) => (
              <li key={j.id}>
                <Link to={`/admin/jobs/${j.id}`} className="block rounded-2xl bg-ink p-4 ring-1 ring-line transition hover:bg-navy-hover">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-lg font-bold tabular-nums text-gold">{j.code}</span>
                    <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{j.customer_name ?? <span className="text-steel">Walk-in</span>}</span>
                    <span className="shrink-0 tabular-nums">{money(j.estimated_price)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-steel">
                    <span className="tabular-nums">{fmtDate(j.created_at)}, {fmtTime(j.created_at)}</span>
                    <span className="flex items-center gap-1.5 tabular-nums">{j.total_pages} pages <span aria-hidden>·</span> <ModeLabel mode={j.mode} /></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ModeLabel({ mode }: { mode: Job["mode"] }) {
  const Icon = mode === "self" ? Printer : Store;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="h-3.5 w-3.5 text-steel" />
      {mode === "self" ? "Self-print" : "Counter"}
    </span>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-ink p-4 ring-1 ring-line">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-steel">
        <Icon aria-hidden className="h-4 w-4 text-gold" /> {label}
      </div>
      <div className="mt-1 truncate text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
