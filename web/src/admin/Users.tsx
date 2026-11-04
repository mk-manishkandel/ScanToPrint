import { useEffect, useState } from "react";
import { KeyRound, Power, Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { api, type User } from "../api";
import { Badge, Button, Card, ErrorText, Field, IconButton, Input, PageHeader, Select } from "../components/ui";
import { useAuth } from "./AdminApp";

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "staff" });
  const [busy, setBusy] = useState(false);

  const load = () => api.get<User[]>("/api/admin/users").then(setUsers, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader icon={UsersIcon} title="Staff accounts" description="Owners can change settings and printers. Staff can only handle print jobs." />
      <ErrorText error={error} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <Card className="!p-2">
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className={`flex flex-wrap items-center gap-3 p-3 ${u.active ? "" : "opacity-60"}`}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold/15 text-sm font-bold text-gold ring-1 ring-gold/30">{initials(u.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {u.name} {u.id === me.id && <span className="text-xs text-steel">(you)</span>}
                </div>
                <div className="text-sm text-steel">@{u.username}</div>
              </div>
              <Badge tone={u.role === "owner" ? "amber" : "slate"}>{u.role}</Badge>
              {!u.active && <Badge tone="red">disabled</Badge>}
              {u.id !== me.id && (
                <div className="flex">
                  <IconButton
                    icon={KeyRound}
                    label={`Reset password for ${u.name}`}
                    onClick={() => {
                      const pw = prompt(`New password for ${u.name} (at least 8 characters):`);
                      if (pw) run(() => api.patch(`/api/admin/users/${u.id}`, { password: pw }));
                    }}
                  />
                  <IconButton
                    icon={Power}
                    label={u.active ? `Disable ${u.name}` : `Enable ${u.name}`}
                    onClick={() => run(() => api.patch(`/api/admin/users/${u.id}`, { active: !u.active }))}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${u.name}`}
                    className="hover:!bg-danger/10 hover:!text-danger"
                    onClick={() => confirm(`Delete ${u.name}?`) && run(() => api.del(`/api/admin/users/${u.id}`))}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card as="section">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            run(async () => {
              await api.post("/api/admin/users", form);
              setForm({ name: "", username: "", password: "", role: "staff" });
            }).finally(() => setBusy(false));
          }}
        >
          <h2 className="flex items-center gap-2 font-semibold"><UserPlus aria-hidden className="h-4 w-4 text-gold" /> Add a staff member</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Username" hint="Letters, numbers, dots or underscores.">
              <Input autoComplete="off" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff: print jobs</option>
                <option value="owner">Owner: everything, including settings</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" icon={UserPlus} loading={busy} disabled={!form.name || !form.username || form.password.length < 8}>
            Add account
          </Button>
        </form>
      </Card>
      </div>
    </div>
  );
}
