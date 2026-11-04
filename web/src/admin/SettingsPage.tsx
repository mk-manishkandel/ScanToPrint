import { useEffect, useState } from "react";
import { VersionInfo } from "./UpdateBanner";
import { CheckCircle2, Coins, Save, Settings as SettingsIcon, Store } from "lucide-react";
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

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader icon={SettingsIcon} title="Settings" description="Your shop name, file limits and price list." />
      <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card as="section" className="space-y-5">
        <h2 className="flex items-center gap-2 font-semibold"><Store aria-hidden className="h-4 w-4 text-gold" /> Shop</h2>
        <Field label="Shop name" hint="Customers see this when they scan the QR code.">
          <Input value={s.shop_name} onChange={(e) => { setSaved(false); setS({ ...s, shop_name: e.target.value }); }} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Keep files for (days)" hint="Older files are deleted automatically.">
            <Input type="number" inputMode="numeric" min={1} max={365} value={s.retention_days} onChange={num("retention_days")} />
          </Field>
          <Field label="Max file size (MB)">
            <Input type="number" inputMode="numeric" min={1} max={500} value={s.max_file_mb} onChange={num("max_file_mb")} />
          </Field>
          <Field label="Max files per job">
            <Input type="number" inputMode="numeric" min={1} max={100} value={s.max_files_per_job} onChange={num("max_files_per_job")} />
          </Field>
        </div>
      </Card>
      <Card as="section" className="space-y-5">
        <h2 className="flex items-center gap-2 font-semibold"><Coins aria-hidden className="h-4 w-4 text-gold" /> Prices</h2>
        <Field label="Currency symbol">
          <Input className="max-w-32" value={s.currency} onChange={(e) => { setSaved(false); setS({ ...s, currency: e.target.value }); }} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Black & white, one side" hint="Per page">
            <Input type="number" inputMode="decimal" step="0.5" min={0} value={s.price_bw_single} onChange={num("price_bw_single")} />
          </Field>
          <Field label="Black & white, both sides" hint="Per sheet">
            <Input type="number" inputMode="decimal" step="0.5" min={0} value={s.price_bw_duplex} onChange={num("price_bw_duplex")} />
          </Field>
          <Field label="Colour, one side" hint="Per page">
            <Input type="number" inputMode="decimal" step="0.5" min={0} value={s.price_color_single} onChange={num("price_color_single")} />
          </Field>
          <Field label="Colour, both sides" hint="Per sheet">
            <Input type="number" inputMode="decimal" step="0.5" min={0} value={s.price_color_duplex} onChange={num("price_color_duplex")} />
          </Field>
        </div>
      </Card>
      </div>
      <Card className="md:hidden">
        <h2 className="mb-2 font-semibold">App version</h2>
        <VersionInfo className="!text-sm" />
      </Card>
      <ErrorText error={error} />
      <div className="sticky bottom-4 flex items-center gap-3 rounded-2xl bg-deep p-3 ring-1 ring-line">
        <Button type="submit" size="lg" icon={Save} loading={busy}>{busy ? "Saving…" : "Save settings"}</Button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-gold animate-fade-in">
            <CheckCircle2 aria-hidden className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
