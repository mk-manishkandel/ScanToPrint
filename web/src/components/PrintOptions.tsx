import { useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, Droplet, Palette, Printer as PrinterIcon, Square } from "lucide-react";
import type { JobFile, PrintItem, PrintPlan, PrinterOption } from "../api";
import { Chip, ErrorText, FileIcon, Input, Segmented, Select, Spinner, Stepper } from "./ui";

export type PrintBody = { printer_id?: number; items: PrintItem[] };
export type PrintState = { body: PrintBody | null; plan: PrintPlan | null };
type Caps = { color: boolean; duplex: boolean; paper_sizes: string[] };
type Item = PrintItem & { include: boolean };

/**
 * Per-file print options with a live price.
 * - With `printers`: pick a printer; options follow what that printer can do.
 * - Without (customer "Submit to shop"): options follow `caps`, what the shop can print.
 */
export function PrintOptions({
  files,
  printers,
  caps,
  initial,
  quote,
  onChange,
  priceLabel = "Total",
}: {
  files: JobFile[];
  printers?: PrinterOption[];
  caps?: Caps;
  initial?: Record<number, PrintItem | null | undefined>;
  quote: (body: PrintBody) => Promise<PrintPlan>;
  onChange: (state: PrintState) => void;
  priceLabel?: string;
}) {
  const printable = files.filter((f) => f.conversion_status === "ok");
  const [printerId, setPrinterId] = useState<number | null>(printers?.[0]?.id ?? null);
  const printer = printers?.find((p) => p.id === printerId) ?? null;
  const can: Caps = printer
    ? { color: printer.supports_color, duplex: printer.supports_duplex, paper_sizes: printer.paper_sizes }
    : caps ?? { color: true, duplex: true, paper_sizes: ["A4"] };

  const [items, setItems] = useState<Record<number, Item>>(() =>
    Object.fromEntries(
      printable.map((f) => {
        const r = initial?.[f.id];
        return [
          f.id,
          {
            file_id: f.id,
            include: true,
            page_range: r?.page_range ?? "",
            copies: r?.copies ?? 1,
            color: r?.color ?? false,
            duplex: r?.duplex ?? false,
            paper_size: r?.paper_size ?? "A4",
          },
        ];
      }),
    ),
  );
  const [plan, setPlan] = useState<PrintPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep every option valid for the chosen printer (or the shop).
  const capsKey = `${can.color}|${can.duplex}|${can.paper_sizes.join(",")}`;
  useEffect(() => {
    setItems((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(next)) {
        const it = { ...next[+k] };
        if (!can.color) it.color = false;
        if (!can.duplex) it.duplex = false;
        if (!can.paper_sizes.includes(it.paper_size)) it.paper_size = can.paper_sizes[0] ?? "A4";
        next[+k] = it;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capsKey]);

  const body = useMemo<PrintBody | null>(() => {
    if (printers && !printerId) return null;
    const list = Object.values(items)
      .filter((i) => i.include)
      .map(({ include: _i, ...rest }) => rest);
    if (!list.length) return null;
    return printers ? { printer_id: printerId!, items: list } : { items: list };
  }, [printers, printerId, items]);

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
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const update = (id: number, patch: Partial<Item>) => setItems((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  const copyToAll = (from: Item) =>
    setItems((cur) =>
      Object.fromEntries(
        Object.entries(cur).map(([k, v]) => [k, { ...v, copies: from.copies, color: from.color, duplex: from.duplex, paper_size: from.paper_size }]),
      ),
    );

  if (printers && !printers.length) return <ErrorText error="No printers are available right now. Please ask at the counter." />;
  if (!printable.length) return <ErrorText error="None of these files can be printed automatically. The shop will open them for you." />;

  return (
    <div className="space-y-5">
      {printers && (
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-steel">Printer</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {printers.map((p) => {
              const on = p.id === printerId;
              return (
                <label
                  key={p.id}
                  className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl p-3 ring-1 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold/70 ${
                    on ? "bg-navy-hover ring-2 ring-gold" : "bg-midnight/50 ring-line hover:ring-line-strong"
                  }`}
                >
                  <input type="radio" name="printer" className="sr-only" checked={on} onChange={() => setPrinterId(p.id)} />
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? "bg-gold text-midnight" : "bg-ink text-gold"}`}>
                    <PrinterIcon aria-hidden className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.display_name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Chip accent={p.supports_color}>{p.supports_color ? "Colour" : "B&W only"}</Chip>
                      {p.supports_duplex && <Chip>Both sides</Chip>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {printable.map((f, idx) => {
        const it = items[f.id];
        if (!it) return null;
        const line = plan?.items.find((p) => p.file_id === f.id);
        return (
          <section key={f.id} aria-label={f.original_name} className={`rounded-2xl p-4 ring-1 transition ${it.include ? "bg-midnight/40 ring-line" : "bg-transparent ring-line opacity-70"}`}>
            <div className="flex items-center gap-3">
              <FileIcon name={f.original_name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.original_name}</div>
                <div className="text-xs text-steel">
                  {f.page_count} page{f.page_count === 1 ? "" : "s"}
                  {line && ` · ${line.quote.sheets} sheet${line.quote.sheets === 1 ? "" : "s"}`}
                </div>
              </div>
              {printable.length > 1 ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-steel">
                  <input type="checkbox" className="h-5 w-5 accent-gold" checked={it.include} onChange={(e) => update(f.id, { include: e.target.checked })} />
                  Print
                </label>
              ) : null}
              {line && <div className="text-right text-sm font-semibold tabular-nums text-gold">{plan!.currency} {line.quote.price.toFixed(2)}</div>}
            </div>

            {it.include && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Segmented
                  className="col-span-2 sm:col-span-1"
                  label="Colour"
                  value={it.color ? "color" : "bw"}
                  onChange={(v) => update(f.id, { color: v === "color" })}
                  options={[
                    { value: "bw", label: "B&W", icon: Droplet },
                    { value: "color", label: "Colour", icon: Palette, disabled: !can.color },
                  ]}
                />
                <Segmented
                  className="col-span-2 sm:col-span-1"
                  label="Sides"
                  value={it.duplex ? "both" : "one"}
                  onChange={(v) => update(f.id, { duplex: v === "both" })}
                  options={[
                    { value: "one", label: "One side", icon: Square },
                    { value: "both", label: "Both sides", icon: BookOpen, disabled: !can.duplex },
                  ]}
                />
                {(!can.color || !can.duplex) && (
                  <p className="col-span-2 -mt-1 text-xs text-steel">
                    {printer ? "This printer" : "The shop"} {!can.color && !can.duplex ? "prints black & white, one side only" : !can.color ? "prints black & white only" : "prints on one side only"}.
                  </p>
                )}
                <Stepper label="Copies" value={it.copies} onChange={(n) => update(f.id, { copies: n })} />
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-steel">Paper</span>
                  <Select value={it.paper_size} onChange={(e) => update(f.id, { paper_size: e.target.value })}>
                    {can.paper_sizes.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-steel">Pages</span>
                  <Input
                    placeholder={`All pages (1-${f.page_count})`}
                    inputMode="text"
                    autoComplete="off"
                    value={it.page_range}
                    onChange={(e) => update(f.id, { page_range: e.target.value })}
                  />
                  <span className="mt-1 block text-xs text-steel">Leave empty for all. Example: 1-3, 5</span>
                </label>
                {idx === 0 && printable.length > 1 && (
                  <button
                    type="button"
                    onClick={() => copyToAll(it)}
                    className="col-span-2 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium text-gold transition hover:bg-navy-hover"
                  >
                    <Copy aria-hidden className="h-4 w-4" /> Use these settings for all files
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      <ErrorText error={error} />
      <div className="flex items-center justify-between rounded-2xl bg-deep px-4 py-3.5 ring-1 ring-gold/20" aria-live="polite">
        <div className="text-sm text-steel">
          {plan ? `${plan.total_sheets} sheet${plan.total_sheets === 1 ? "" : "s"}` : "Choose options"}
          {loading && <Spinner className="ml-2 inline h-3.5 w-3.5" label="Updating price" />}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-steel">{priceLabel}</div>
          <div className="text-xl font-bold tabular-nums text-gold">{plan ? `${plan.currency} ${plan.total_price.toFixed(2)}` : "—"}</div>
        </div>
      </div>
    </div>
  );
}
