import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, ApiError, type User } from "../api";
import { Button, Logo, Spinner } from "../components/ui";
import Login from "./Login";
import Setup from "./Setup";
import SettingsPage from "./SettingsPage";
import Users from "./Users";
import Queue from "./Queue";
import JobDetail from "./JobDetail";
import Printers from "./Printers";
import History from "./History";
import QrPoster from "./QrPoster";
import UpdateBanner from "./UpdateBanner";

interface AuthCtx {
  user: User;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;

type State = { kind: "loading" } | { kind: "setup" } | { kind: "login" } | { kind: "ready"; user: User };

export default function AdminApp() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<{ needs_setup: boolean }>("/api/setup/status");
      if (s.needs_setup) return setState({ kind: "setup" });
      const user = await api.get<User>("/api/admin/me");
      setState({ kind: "ready", user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ kind: "login" });
      else setTimeout(refresh, 2000);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.kind === "loading")
    return (
      <div className="grid min-h-screen place-items-center text-gold">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (state.kind === "setup") return <Setup onDone={(user) => setState({ kind: "ready", user })} />;
  if (state.kind === "login") return <Login onDone={(user) => setState({ kind: "ready", user })} />;

  const logout = async () => {
    await api.post("/api/admin/logout");
    setState({ kind: "login" });
  };

  return (
    <Ctx.Provider value={{ user: state.user, logout }}>
      <Shell />
    </Ctx.Provider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const links = [
    { to: "/admin", label: "Print queue", end: true },
    { to: "/admin/history", label: "History" },
    ...(user.role === "owner"
      ? [
          { to: "/admin/printers", label: "Printers" },
          { to: "/admin/settings", label: "Settings" },
          { to: "/admin/staff", label: "Staff" },
        ]
      : []),
    { to: "/admin/qr", label: "QR poster" },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 print:hidden shrink-0 flex-col border-r border-line bg-deep text-frost/85">
        <div className="flex items-center gap-2.5 px-5 py-5 text-lg font-bold text-frost">
          <Logo className="h-8 w-8" />
          ScanToPrint
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-gold text-midnight" : "hover:bg-navy-hover"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-4 text-sm">
          <div className="font-medium text-frost">{user.name}</div>
          <div className="text-xs capitalize text-steel/80">{user.role}</div>
          <Button variant="ghost" className="mt-2 w-full !text-steel hover:!bg-navy-hover" onClick={logout}>
            Log out
          </Button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
      <UpdateBanner isOwner={user.role === "owner"} />
      <main className="p-6 print:p-0">
        <Routes>
          <Route index element={<Queue />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="history" element={<History />} />
          <Route path="qr" element={<QrPoster />} />
          {user.role === "owner" && (
            <>
              <Route path="printers" element={<Printers />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="staff" element={<Users />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
      </div>
    </div>
  );
}
