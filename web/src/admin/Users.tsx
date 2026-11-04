import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { Badge, Button, Card, ErrorText, Field, Input } from "../components/ui";
import { useAuth } from "./AdminApp";

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "staff" });

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

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Staff accounts</h1>
      <ErrorText error={error} />
      <Card className="divide-y divide-slate-100 !p-0">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1">
              <div className="font-medium">
                {u.name} {u.id === me.id && <span className="text-xs text-slate-400">(you)</span>}
              </div>
              <div className="text-sm text-slate-500">@{u.username}</div>
            </div>
            <Badge tone={u.role === "owner" ? "teal" : "slate"}>{u.role}</Badge>
            {!u.active && <Badge tone="red">disabled</Badge>}
            {u.id !== me.id && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const pw = prompt(`New password for ${u.name} (at least 8 characters):`);
                    if (pw) run(() => api.patch(`/api/admin/users/${u.id}`, { password: pw }));
                  }}
                >
                  Reset password
                </Button>
                <Button variant="secondary" onClick={() => run(() => api.patch(`/api/admin/users/${u.id}`, { active: !u.active }))}>
                  {u.active ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  className="!text-red-600"
                  onClick={() => confirm(`Delete ${u.name}?`) && run(() => api.del(`/api/admin/users/${u.id}`))}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        ))}
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Add staff member</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Username">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="staff">Staff — print jobs</option>
              <option value="owner">Owner — everything incl. settings</option>
            </select>
          </Field>
        </div>
        <Button
          disabled={!form.name || !form.username || !form.password}
          onClick={() =>
            run(async () => {
              await api.post("/api/admin/users", form);
              setForm({ name: "", username: "", password: "", role: "staff" });
            })
          }
        >
          Add account
        </Button>
      </Card>
    </div>
  );
}
