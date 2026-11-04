import { useEffect, useState } from "react";
import { VersionInfo } from "./UpdateBanner";
import { CheckCircle2, Coins, Save, Settings as SettingsIcon, Store, type LucideIcon } from "lucide-react";
import { api, type Settings } from "../api";
import { Button, Card, ErrorText, Field, Input, PageHeader, Spinner } from "../components/ui";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>("/api/admin/settings").then(setS, (e) => setError(e.message));
  }, []);

  if (!s) return error ? <ErrorText error={error} /> : <div className="grid place-items-center py-20"><Spinner className="h-7 w-7" /></div>;

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setS({ ...s, [k]: e.target.value === "" ? 0 : Number(e.target.value) });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setS(await api.put<Settings>("/api/admin/settings", s));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = (k: "shop_name" | "currency") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setS({ ...s, [k]: e.target.value });
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Your shop name, file limits and price list."
        actions={
          <div className="flex items-center gap-3">
            {saved && (
              <span role="status" className="inline-flex items-center gap-1.5 text-sm text-gold animate-fade-in">
                <CheckCircle2 aria-hidden className="h-4 w-4" /> Saved
              </span>
            )}
            <Button type="submit" icon={Save} loading={busy}>{busy ? "Saving…" : "Save settings"}</Button>
          </div>
        }
      />
      <ErrorText error={error} />

      {/* Row 1: the shop. */}
      <Card as="section">
        <SectionTitle icon={Store} title="Shop" hint={<><span className="text-danger">*</span> Required</>} />
        <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <Field label="Shop name" required hint="Customers see this when they scan the QR code." className="sm:col-span-3 xl:col-span-1">
            <Input required value={s.shop_name} onChange={text("shop_name")} />
          </Field>
          <Field label="Keep files for (days)" required hint="Older files are deleted automatically.">
            <Input required type="number" inputMode="numeric" min={1} max={365} value={s.retention_days} onChange={num("retention_days")} />
          </Field>
          <Field label="Max file size (MB)" required hint="For each uploaded file.">
            <Input required type="number" inputMode="numeric" min={1} max={500} value={s.max_file_mb} onChange={num("max_file_mb")} />
          </Field>
          <Field label="Max files per job" required hint="How many files one customer can send.">
            <Input required type="number" inputMode="numeric" min={1} max={100} value={s.max_files_per_job} onChange={num("max_files_per_job")} />
          </Field>
        </div>
      </Card>

      {/* Row 2: the price list, laid out as a 2 x 2 grid. */}
      <Card as="section">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionTitle icon={Coins} title="Prices" />
          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="text-steel">Currency symbol</span>
            <Input className="!min-h-10 !w-24 !py-2 text-center" value={s.currency} onChange={text("currency")} />
          </label>
        </div>
        <div role="table" aria-label="Price list" className="mt-5 overflow-hidden rounded-xl ring-1 ring-line">
          <div role="row" className="grid grid-cols-2 gap-x-4 bg-midnight px-4 py-3 text-xs font-medium uppercase tracking-wider text-steel sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span role="columnheader" className="hidden sm:block">Paper</span>
            <span role="columnheader">One side <span className="normal-case tracking-normal">· per page</span></span>
            <span role="columnheader">Both sides <span className="normal-case tracking-normal">· per sheet</span></span>
          </div>
          {([
            ["Black & white", "price_bw_single", "price_bw_duplex"],
            ["Colour", "price_color_single", "price_color_duplex"],
          ] as const).map(([label, one, both]) => (
            <div key={label} role="row" className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-line px-4 py-4 sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
              <span role="rowheader" className="col-span-2 font-medium sm:col-span-1">{label}</span>
              {[one, both].map((k) => (
                <span role="cell" key={k}>
                  <Money currency={s.currency} label={`${label}, ${k === one ? "one side" : "both sides"}`} value={s[k]} onChange={num(k)} />
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-steel">Customers see these prices before they print by themselves. Both-sides prices are for one sheet with print on each side.</p>
      </Card>

      <Card className="md:hidden">
        <h2 className="mb-2 font-semibold">App version</h2>
        <VersionInfo className="!text-sm" />
      </Card>
    </form>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="flex items-center gap-2 font-semibold"><Icon aria-hidden className="h-4 w-4 text-gold" /> {title}</h2>
      {hint && <span className="text-xs text-steel">{hint}</span>}
    </div>
  );
}

/** Number input with the currency shown inside it. */
function Money({ currency, label, value, onChange }: { currency: string; label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <span className="relative block">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-steel">{currency}</span>
      <Input aria-label={label} type="number" inputMode="decimal" step="0.5" min={0} value={value} onChange={onChange} style={{ paddingLeft: `${Math.max(2.5, currency.length * 0.6 + 1.6)}rem` }} />
    </span>
  );
}
