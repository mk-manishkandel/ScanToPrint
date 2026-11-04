import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api, type User } from "../api";
import { Button, ErrorText, Field, IconButton, Input, Logo } from "../components/ui";

export default function Login({ onDone }: { onDone: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.post<User>("/api/admin/login", { username, password }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to the shop dashboard">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <Input autoFocus autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input
              className="!pr-12"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <IconButton type="button" icon={show ? EyeOff : Eye} label={show ? "Hide password" : "Show password"} className="absolute right-0 top-0" onClick={() => setShow(!show)} />
          </div>
        </Field>
        <ErrorText error={error} />
        <Button type="submit" size="lg" icon={LogIn} className="w-full" loading={busy} disabled={!username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className={`w-full ${wide ? "max-w-md" : "max-w-sm"} animate-rise`}>
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-16 w-16" />
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.25em] text-gold">ScanToPrint</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-steel">{subtitle}</p>
        </div>
        <div className="rounded-3xl bg-ink p-6 shadow-2xl shadow-black/40 ring-1 ring-line">{children}</div>
        <p className="mt-4 text-center text-xs tabular-nums text-steel">ScanToPrint version {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
