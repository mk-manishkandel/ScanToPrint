import { useEffect, useState } from "react";
import { AlertTriangle, Check, Info, Printer, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import { api, type AdminPrinter } from "../api";
import { Badge, Button, Card, EmptyState, ErrorText, IconButton, Input, Notice, PageHeader, Switch } from "../components/ui";

const PAPERS = ["A4", "A3", "A5", "letter", "legal"];

export default function Printers() {
  const [printers, setPrinters] = useState<AdminPrinter[] | null>(null);
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
      setInfo(
        r.added
          ? `Found ${r.found} printer(s) in Windows, ${r.added} new. Colour and double-sided were read from Windows. Check they're right.`
          : `Found ${r.found} printer(s) in Windows. Nothing new.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function patch(id: number, body: Partial<AdminPrinter>) {
    setError(null);
    // Optimistic: flip immediately, then sync with the server.
    setPrinters((cur) => cur?.map((p) => (p.id === id ? { ...p, ...body } : p)) ?? cur);
    try {
      await api.patch(`/api/admin/printers/${id}`, body);
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Printer}
        title="Printers"
        description="Turn on the printers you use. Customers only see printers marked “Customers can self-print”."
        actions={<Button icon={scanning ? RefreshCw : ScanSearch} loading={scanning} onClick={scan}>{scanning ? "Scanning…" : "Scan for printers"}</Button>}
      />
      {info && <Notice icon={Info}>{info}</Notice>}
      <ErrorText error={error} />
      {printers && printers.length === 0 && (
        <EmptyState icon={Printer} title="No printers yet" action={<Button icon={ScanSearch} onClick={scan} loading={scanning}>Scan for printers</Button>}>
          Install your printer in Windows first (Settings → Bluetooth & devices → Printers), then scan.
        </EmptyState>
      )}
      <div className="grid items-start gap-6 2xl:grid-cols-2">
      {printers?.map((p) => (
        <Card key={p.id} as="section" className={`space-y-4 animate-rise ${p.is_active ? "" : "opacity-80"}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${p.is_active ? "bg-gold text-midnight" : "bg-midnight text-steel ring-1 ring-line"}`}>
              <Printer aria-hidden className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`pn-${p.id}`}>Display name</label>
              <Input
                id={`pn-${p.id}`}
                className="!min-h-10 font-semibold"
                defaultValue={p.display_name}
                onBlur={(e) => e.target.value !== p.display_name && patch(p.id, { display_name: e.target.value })}
              />
              <div className="mt-1 truncate text-xs text-steel">Windows name: {p.system_name}</div>
            </div>
            {p.is_active ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}
            {!p.installed && (
              <Badge tone="red"><AlertTriangle aria-hidden className="h-3 w-3" /> Not found in Windows</Badge>
            )}
            <IconButton
              icon={Trash2}
              label={`Remove ${p.display_name}`}
              className="hover:!bg-danger/10 hover:!text-danger"
              onClick={() => confirm(`Remove ${p.display_name}?`) && api.del(`/api/admin/printers/${p.id}`).then(load)}
            />
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <Switch label="Active" description="Staff can print to it" checked={p.is_active} onChange={(v) => patch(p.id, { is_active: v })} />
            <Switch label="Customers can self-print" description="Shown on the customer page" checked={p.allow_self_print} onChange={(v) => patch(p.id, { allow_self_print: v })} />
            <Switch label="Colour" description="Allow colour printing" checked={p.supports_color} onChange={(v) => patch(p.id, { supports_color: v })} />
            <Switch label="Double-sided" description="Allow printing on both sides" checked={p.supports_duplex} onChange={(v) => patch(p.id, { supports_duplex: v })} />
          </div>
          <fieldset className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <legend className="sr-only">Paper sizes</legend>
            <span aria-hidden className="mr-1 text-xs font-medium uppercase tracking-wider text-steel">Paper</span>
            {PAPERS.map((s) => {
              const on = p.paper_sizes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? p.paper_sizes.filter((x) => x !== s) : [...p.paper_sizes, s];
                    if (next.length) patch(p.id, { paper_sizes: next });
                  }}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition ${
                    on ? "bg-gold/15 text-gold ring-gold/50" : "text-steel ring-line hover:text-frost hover:ring-line-strong"
                  }`}
                >
                  {on && <Check aria-hidden className="h-3.5 w-3.5" />}
                  {s}
                </button>
              );
            })}
          </fieldset>
        </Card>
      ))}
      </div>
    </div>
  );
}
