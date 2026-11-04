import { useState, type FormEvent } from "react";
import { api, type User } from "../api";
import { Button, Card, ErrorText, Field, Input } from "../components/ui";

/** First run: create the shop and the owner account. */
export default function Setup({ onDone }: { onDone: (u: User) => void }) {
  const [form, setForm] = useState({ shop_name: "", name: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("Passwords don't match");
    setBusy(true);
    setError(null);
    try {
      const { confirm: _c, ...body } = form;
      onDone(await api.post<User>("/api/setup", body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-brand-700">Welcome to ScanToPrint</h1>
        <p className="mb-6 mt-1 text-sm text-slate-600">
          Let's set up your shop. You'll add printers and print your QR poster next.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Shop name" hint="Customers see this when they scan the QR code.">
            <Input autoFocus value={form.shop_name} onChange={set("shop_name")} placeholder="e.g. Kandel Stationery" />
          </Field>
          <Field label="Your name">
            <Input value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Owner username" hint="Letters, numbers, dots or underscores.">
            <Input autoComplete="username" value={form.username} onChange={set("username")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Password" hint="At least 8 characters.">
              <Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            </Field>
            <Field label="Confirm">
              <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
            </Field>
          </div>
          <ErrorText error={error} />
          <Button className="w-full" disabled={busy || !form.shop_name || !form.username || !form.password}>
            {busy ? "Setting up…" : "Create shop"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
