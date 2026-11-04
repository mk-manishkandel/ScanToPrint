import { useEffect, useState } from "react";
import { api, type Settings } from "../api";
import { Button, Card, ErrorText, Field, Input, Spinner } from "../components/ui";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>("/api/admin/settings").then(setS, (e) => setError(e.message));
  }, []);

  if (!s) return error ? <ErrorText error={error} /> : <Spinner />;

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: e.target.value === "" ? 0 : Number(e.target.value) });

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setS(await api.put<Settings>("/api/admin/settings", s));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card className="space-y-4">
        <h2 className="font-semibold">Shop</h2>
        <Field label="Shop name">
          <Input value={s.shop_name} onChange={(e) => setS({ ...s, shop_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Keep files for (days)" hint="Older customer files are deleted automatically.">
            <Input type="number" min={1} max={365} value={s.retention_days} onChange={num("retention_days")} />
          </Field>
          <Field label="Max file size (MB)">
            <Input type="number" min={1} max={500} value={s.max_file_mb} onChange={num("max_file_mb")} />
          </Field>
          <Field label="Max files per job">
            <Input type="number" min={1} max={100} value={s.max_files_per_job} onChange={num("max_files_per_job")} />
          </Field>
        </div>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Prices (per printed side)</h2>
        <Field label="Currency symbol">
          <Input className="max-w-32" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Black & white — single-sided (per page)">
            <Input type="number" step="0.5" min={0} value={s.price_bw_single} onChange={num("price_bw_single")} />
          </Field>
          <Field label="Black & white — double-sided (per sheet)">
            <Input type="number" step="0.5" min={0} value={s.price_bw_duplex} onChange={num("price_bw_duplex")} />
          </Field>
          <Field label="Colour — single-sided (per page)">
            <Input type="number" step="0.5" min={0} value={s.price_color_single} onChange={num("price_color_single")} />
          </Field>
          <Field label="Colour — double-sided (per sheet)">
            <Input type="number" step="0.5" min={0} value={s.price_color_duplex} onChange={num("price_color_duplex")} />
          </Field>
        </div>
      </Card>
      <ErrorText error={error} />
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        {saved && <span className="text-sm text-gold">Saved ✓</span>}
      </div>
    </div>
  );
}
