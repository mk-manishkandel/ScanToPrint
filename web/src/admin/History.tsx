import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileStack, History as HistoryIcon, Printer, Search, Store } from "lucide-react";
import { api, STATUS_LABEL, STATUS_TONE, type Job } from "../api";
import { Badge, Card, EmptyState, ErrorText, Input, PageHeader, Spinner } from "../components/ui";

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

  return (
    <div className="space-y-6">
      <PageHeader icon={HistoryIcon} title="History" description="Every job, newest first. Click a row to open it." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search</span>
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <Input className="!pl-10" placeholder="Search code, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="block">
          <span className="sr-only">Date</span>
          <Input className="w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2 text-sm">
          <Stat label="Jobs" value={list.length} />
          <Stat label="Pages" value={pages} />
          <Stat label="Value" value={revenue.toFixed(2)} />
        </div>
      </div>
      <ErrorText error={error} />
      {!jobs && !error && <div className="grid place-items-center py-16"><Spinner className="h-7 w-7" /></div>}
      {jobs && list.length === 0 && (
        <EmptyState icon={FileStack} title="No jobs found">{q || date ? "Try a different search or date." : "Jobs appear here once customers start uploading."}</EmptyState>
      )}
      {list.length > 0 && (
        <Card className="overflow-x-auto !p-0 animate-fade-in">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-steel">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="py-3 font-medium">Customer</th>
                <th className="py-3 font-medium">When</th>
                <th className="py-3 font-medium">Type</th>
                <th className="py-3 text-right font-medium">Files</th>
                <th className="py-3 text-right font-medium">Pages</th>
                <th className="py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((j) => (
                <tr
                  key={j.id}
                  onClick={() => navigate(`/admin/jobs/${j.id}`)}
                  className="cursor-pointer border-t border-line transition first:border-0 hover:bg-navy-hover"
                >
                  <td className="px-5 py-3">
                    <Link to={`/admin/jobs/${j.id}`} className="font-bold tabular-nums text-gold hover:text-gold-soft" onClick={(e) => e.stopPropagation()}>
                      {j.code}
                    </Link>
                  </td>
                  <td className="py-3">
                    {j.customer_name ?? <span className="text-steel">Walk-in</span>}
                    {j.customer_phone && <div className="text-xs text-steel">{j.customer_phone}</div>}
                  </td>
                  <td className="py-3 text-frost/80">{new Date(j.created_at).toLocaleString()}</td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-1.5 text-frost/80">
                      {j.mode === "self" ? <Printer aria-hidden className="h-3.5 w-3.5 text-steel" /> : <Store aria-hidden className="h-3.5 w-3.5 text-steel" />}
                      {j.mode === "self" ? "Self" : "Counter"}
                    </span>
                  </td>
                  <td className="py-3 text-right tabular-nums">{j.files.length}</td>
                  <td className="py-3 text-right tabular-nums">{j.total_pages}</td>
                  <td className="py-3 text-right tabular-nums">{j.estimated_price ? j.estimated_price.toFixed(2) : "—"}</td>
                  <td className="px-5 py-3"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-ink/80 px-3.5 py-2 ring-1 ring-line">
      <div className="text-[11px] uppercase tracking-wider text-steel">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
