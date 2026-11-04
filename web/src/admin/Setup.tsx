import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { api, type User } from "../api";
import { Button, ErrorText, Field, Input } from "../components/ui";
import { AuthLayout } from "./Login";

/** First run: create the shop and the owner account. */
export default function Setup({ onDone }: { onDone: (u: User) => void }) {
  const [form, setForm] = useState({ shop_name: "", name: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const mismatch = form.confirm.length > 0 && form.password !== form.confirm;
  const short = form.password.length > 0 && form.password.length < 8;

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
    <AuthLayout wide title="Set up your shop" subtitle="Takes a minute. Next you'll add printers and print your QR poster.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Shop name" hint="Customers see this when they scan the QR code.">
          <Input autoFocus value={form.shop_name} onChange={set("shop_name")} placeholder="e.g. Kandel Stationery" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name">
            <Input autoComplete="name" value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Username" hint="Letters, numbers, dots or underscores.">
            <Input autoComplete="username" autoCapitalize="none" value={form.username} onChange={set("username")} />
          </Field>
          <Field label="Password" hint="At least 8 characters." error={short ? "At least 8 characters" : null}>
            <Input type="password" autoComplete="new-password" aria-invalid={short} value={form.password} onChange={set("password")} />
          </Field>
          <Field label="Confirm password" error={mismatch ? "Passwords don't match" : null}>
            <Input type="password" autoComplete="new-password" aria-invalid={mismatch} value={form.confirm} onChange={set("confirm")} />
          </Field>
        </div>
        <ErrorText error={error} />
        <Button
          type="submit"
          size="lg"
          icon={Sparkles}
          className="w-full"
          loading={busy}
          disabled={!form.shop_name || !form.name || !form.username || form.password.length < 8 || mismatch}
        >
          {busy ? "Setting up…" : "Create shop"}
        </Button>
      </form>
    </AuthLayout>
  );
}
