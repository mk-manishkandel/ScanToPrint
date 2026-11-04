import { useEffect, useMemo, useState } from "react";
import type { JobFile, PrintItem, PrintPlan, PrinterOption } from "../api";
import { ErrorText, Spinner } from "./ui";

/** Printer + per-file options editor with a live price quote. Shared by customers and staff. */
export function PrintOptions({
  files,
  printers,
  quote,
  onChange,
}: {
  files: JobFile[];
  printers: PrinterOption[];
  quote: (body: { printer_id: number; items: PrintItem[] }) => Promise<PrintPlan>;
  onChange: (state: { body: { printer_id: number; items: PrintItem[] } | null; plan: PrintPlan | null }) => void;
}) {
  const printable = files.filter((f) => f.conversion_status === "ok");
  const [printerId, setPrinterId] = useState<number | null>(printers[0]?.id ?? null);
  const printer = printers.find((p) => p.id === printerId) ?? null;
  const [items, setItems] = useState<Record<number, PrintItem & { include: boolean }>>(() =>
    Object.fromEntries(
      printable.map((f) => [f.id, { file_id: f.id, include: true, page_range: "", copies: 1, color: false, duplex: false, paper_size: "A4" }]),
    ),
  );
  const [plan, setPlan] = useState<PrintPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep options valid for the chosen printer.
  useEffect(() => {
    if (!printer) return;
    setItems((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(next)) {
        const it = { ...next[+k] };
        if (!printer.supports_color) it.color = false;
        if (!printer.supports_duplex) it.duplex = false;
        if (!printer.paper_sizes.includes(it.paper_size)) it.paper_size = printer.paper_sizes[0] ?? "A4";
        next[+k] = it;
      }
      return next;
    });
  }, [printer]);

  const body = useMemo(() => {
    if (!printerId) return null;
    const list = Object.values(items)
      .filter((i) => i.include)
      .map(({ include: _i, ...rest }) => rest);
    return list.length ? { printer_id: printerId, items: list } : null;
  }, [printerId, items]);

  useEffect(() => {
    if (!body) {
      setPlan(null);
      onChange({ body: null, plan: null });
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      quote(body)
        .then((p) => {
          setPlan(p);
          setError(null);
          onChange({ body, plan: p });
        })
        .catch((e) => {
          setPlan(null);
          setError(e.message);
          onChange({ body: null, plan: null });
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const update = (id: number, patch: Partial<PrintItem & { include: boolean }>) =>
    setItems((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  if (!printers.length) return <ErrorText error="No printers are available right now. Please ask at the counter." />;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-medium text-frost">Printer</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {printers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPrinterId(p.id)}
              className={`rounded-xl border-2 p-3 text-left ${p.id === printerId ? "border-gold bg-navy-hover" : "border-line bg-ink"}`}
            >
              <div className="font-semibold">{p.display_name}</div>
              <div className="text-xs text-steel">
                {p.supports_color ? "Colour & B/W" : "Black & white"} · {p.supports_duplex ? "Double-sided" : "Single-sided"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {printable.map((f) => {
        const it = items[f.id];
        if (!it) return null;
        const line = plan?.items.find((p) => p.file_id === f.id);
        return (
          <div key={f.id} className={`rounded-xl border p-4 ${it.include ? "border-line bg-ink" : "border-dashed border-line-strong bg-midnight"}`}>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={it.include} onChange={(e) => update(f.id, { include: e.target.checked })} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.original_name}</div>
                <div className="text-xs text-steel">{f.page_count} page{f.page_count === 1 ? "" : "s"}</div>
              </div>
              {line && (
                <div className="text-right text-sm font-semibold text-gold">
                  {plan!.currency} {line.quote.price.toFixed(2)}
                </div>
              )}
            </label>
            {it.include && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="col-span-2 text-xs font-medium text-frost/80">
                  Pages
                  <input
                    className="mt-1 w-full rounded-lg border border-line-strong bg-ink px-3 py-2 text-base"
                    placeholder={`All (1-${f.page_count})`}
                    inputMode="numeric"
                    value={it.page_range}
                    onChange={(e) => update(f.id, { page_range: e.target.value })}
                  />
                </label>
                <label className="text-xs font-medium text-frost/80">
                  Copies
                  <div className="mt-1 flex items-center rounded-lg border border-line-strong">
                    <button type="button" className="px-3 py-2 text-lg" onClick={() => update(f.id, { copies: Math.max(1, it.copies - 1) })}>−</button>
                    <span className="flex-1 text-center text-base">{it.copies}</span>
                    <button type="button" className="px-3 py-2 text-lg" onClick={() => update(f.id, { copies: Math.min(100, it.copies + 1) })}>+</button>
                  </div>
                </label>
                <label className="text-xs font-medium text-frost/80">
                  Paper
                  <select
                    className="mt-1 w-full rounded-lg border border-line-strong bg-ink px-2 py-2.5 text-base"
                    value={it.paper_size}
                    onChange={(e) => update(f.id, { paper_size: e.target.value })}
                  >
                    {(printer?.paper_sizes ?? ["A4"]).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {printer?.supports_color && (
                  <Toggle label="Colour" on={it.color} onClick={() => update(f.id, { color: !it.color })} offLabel="B/W" />
                )}
                {printer?.supports_duplex && (
                  <Toggle label="Both sides" on={it.duplex} onClick={() => update(f.id, { duplex: !it.duplex })} offLabel="One side" />
                )}
              </div>
            )}
          </div>
        );
      })}

      <ErrorText error={error} />
      <div className="flex items-center justify-between rounded-xl bg-deep px-4 py-3 text-frost">
        <div className="text-sm">
          {plan ? `${plan.total_sheets} sheet${plan.total_sheets === 1 ? "" : "s"}` : "—"}
          {loading && <Spinner className="ml-2 h-3 w-3" />}
        </div>
        <div className="text-lg font-bold">{plan ? `${plan.currency} ${plan.total_price.toFixed(2)}` : ""}</div>
      </div>
    </div>
  );
}

function Toggle({ label, offLabel, on, onClick }: { label: string; offLabel: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium ${on ? "border-gold bg-gold text-midnight" : "border-line-strong bg-ink text-frost"}`}
    >
      {on ? label : offLabel}
    </button>
  );
}
