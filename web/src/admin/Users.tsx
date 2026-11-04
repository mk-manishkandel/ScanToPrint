import { useCallback, useEffect, useState } from "react";
import { KeyRound, Power, Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { api, type User } from "../api";
import { Badge, Button, Card, ErrorText, Field, IconButton, Input, PageHeader, Sheet } from "../components/ui";
import { Select } from "../components/pickers";
import { useAuth } from "./AdminApp";

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "staff" });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const empty = { name: "", username: "", password: "", role: "staff" };
  // Stable so the pop-up doesn't re-run its focus setup on every keystroke.
  const closeAdd = useCallback(() => setAdding(false), []);
  const openAdd = () => {
    setForm(empty);
    setFormError(null);
    setAdding(true);
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post("/api/admin/users", form);
      await load();
      setAdding(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
      <PageHeader
        icon={UsersIcon}
        title="Staff accounts"
        description="Owners can change settings and printers. Staff can only handle print jobs."
        actions={<Button icon={UserPlus} onClick={openAdd}>Add staff</Button>}
      />
      <ErrorText error={error} />
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
      {adding && (
        <Sheet
          title="Add a staff member"
          subtitle={<>Fields marked <span className="text-danger">*</span> are required.</>}
          onClose={closeAdd}
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeAdd}>Cancel</Button>
              <Button type="submit" form="add-staff" icon={UserPlus} loading={busy} disabled={!form.name.trim() || !form.username.trim() || form.password.length < 8}>
                Add account
              </Button>
            </div>
          }
        >
          <form id="add-staff" className="space-y-4" onSubmit={add}>
            <Field label="Name" required>
              <Input required autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Username" required hint="Letters, numbers, dots or underscores. Used to sign in.">
              <Input required autoComplete="off" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Password" required hint="At least 8 characters.">
              <Input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Role" required>
              <Select
                label="Role"
                value={form.role}
                onChange={(role) => setForm({ ...form, role })}
                options={[
                  { value: "staff", label: "Staff", description: "Handles print jobs" },
                  { value: "owner", label: "Owner", description: "Everything, including settings and printers" },
                ]}
              />
            </Field>
            <ErrorText error={formError} />
          </form>
        </Sheet>
      )}
    </div>
  );
}
