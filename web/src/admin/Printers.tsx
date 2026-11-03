import { useEffect, useState } from "react";
import { api, type AdminPrinter } from "../api";
import { Badge, Button, Card, ErrorText, Input } from "../components/ui";

const PAPERS = ["A4", "A3", "A5", "letter", "legal"];

export default function Printers() {
  const [printers, setPrinters] = useState<AdminPrinter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = () => api.get<AdminPrinter[]>("/api/admin/printers").then(setPrinters, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const r = await api.post<{ found: number; added: number }>("/api/admin/printers/scan");
      setInfo(`Found ${r.found} printer(s) in Windows, ${r.added} new.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function patch(id: number, body: Partial<AdminPrinter>) {
    setError(null);
    try {
      await api.patch(`/api/admin/printers/${id}`, body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Printers</h1>
          <p className="text-sm text-slate-500">Turn on the printers you use. Customers only see printers with “Customers can self-print”.</p>
        </div>
        <Button onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan for printers"}</Button>
      </div>
      {info && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{info}</p>}
      <ErrorText error={error} />
      {printers.length === 0 && (
        <Card className="text-center text-slate-500">
          No printers yet. Install your printer in Windows first, then click <b>Scan for printers</b>.
        </Card>
      )}
      {printers.map((p) => (
        <Card key={p.id} className={`space-y-4 ${p.is_active ? "" : "opacity-75"}`}>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="max-w-xs font-semibold"
              defaultValue={p.display_name}
              onBlur={(e) => e.target.value !== p.display_name && patch(p.id, { display_name: e.target.value })}
            />
            <span className="text-xs text-slate-500">Windows name: {p.system_name}</span>
            {!p.installed && <Badge tone="red">not found in Windows</Badge>}
            <Button variant="ghost" className="ml-auto !text-red-600" onClick={() => confirm(`Remove ${p.display_name}?`) && api.del(`/api/admin/printers/${p.id}`).then(load)}>
              Remove
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <Check label="Active" checked={p.is_active} onChange={(v) => patch(p.id, { is_active: v })} />
            <Check label="Customers can self-print" checked={p.allow_self_print} onChange={(v) => patch(p.id, { allow_self_print: v })} />
            <Check label="Colour" checked={p.supports_color} onChange={(v) => patch(p.id, { supports_color: v })} />
            <Check label="Double-sided" checked={p.supports_duplex} onChange={(v) => patch(p.id, { supports_duplex: v })} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-500">Paper:</span>
            {PAPERS.map((s) => (
              <Check
                key={s}
                label={s}
                checked={p.paper_sizes.includes(s)}
                onChange={(v) => {
                  const next = v ? [...p.paper_sizes, s] : p.paper_sizes.filter((x) => x !== s);
                  if (next.length) patch(p.id, { paper_sizes: next });
                }}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
