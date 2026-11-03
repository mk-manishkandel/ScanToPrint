import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, STATUS_LABEL, STATUS_TONE, type Job } from "../api";
import { Badge, Card, ErrorText, Input } from "../components/ui";

export default function History() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ view: "all", q, date, limit: "500" });
      api.get<Job[]>(`/api/admin/jobs?${params}`).then(setJobs, (e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, date]);

  const pages = jobs.reduce((s, j) => s + j.total_pages, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">History</h1>
      <div className="flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder="Search code, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Input className="max-w-48" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="self-center text-sm text-slate-500">{jobs.length} jobs · {pages} pages</div>
      </div>
      <ErrorText error={error} />
      <Card className="overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Code</th><th>Customer</th><th>When</th><th>Type</th><th>Files</th><th>Pages</th><th>Amount</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-bold text-brand-700"><Link to={`/admin/jobs/${j.id}`}>{j.code}</Link></td>
                <td>{j.customer_name ?? "—"} <span className="text-slate-400">{j.customer_phone}</span></td>
                <td>{new Date(j.created_at).toLocaleString()}</td>
                <td>{j.mode === "self" ? "Self" : "Submit"}</td>
                <td>{j.files.length}</td>
                <td>{j.total_pages}</td>
                <td>{j.estimated_price ? j.estimated_price.toFixed(2) : "—"}</td>
                <td><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
