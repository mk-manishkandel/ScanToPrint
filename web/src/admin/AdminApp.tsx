import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { History as HistoryIcon, Inbox, LogOut, Printer, QrCode, Settings, Users as UsersIcon, type LucideIcon } from "lucide-react";
import { api, ApiError, type User } from "../api";
import { IconButton, Logo, Spinner } from "../components/ui";
import Login from "./Login";
import Setup from "./Setup";
import SettingsPage from "./SettingsPage";
import Users from "./Users";
import Queue from "./Queue";
import JobDetail from "./JobDetail";
import Printers from "./Printers";
import History from "./History";
import QrPoster from "./QrPoster";
import UpdateBanner, { VersionInfo } from "./UpdateBanner";

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
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Logo className="h-14 w-14" />
          <Spinner className="h-6 w-6" />
        </div>
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

type Link = { to: string; label: string; icon: LucideIcon; end?: boolean };

function Shell() {
  const { user, logout } = useAuth();
  const links: Link[] = [
    { to: "/admin", label: "Print queue", icon: Inbox, end: true },
    { to: "/admin/history", label: "History", icon: HistoryIcon },
    ...(user.role === "owner"
      ? [
          { to: "/admin/printers", label: "Printers", icon: Printer },
          { to: "/admin/settings", label: "Settings", icon: Settings },
          { to: "/admin/staff", label: "Staff", icon: UsersIcon },
        ]
      : []),
    { to: "/admin/qr", label: "QR poster", icon: QrCode },
  ];
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-deep print:hidden md:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <Logo className="h-10 w-10" />
          <div>
            <div className="text-base font-bold tracking-tight">ScanToPrint</div>
            <div className="text-xs text-steel">Shop dashboard</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                  isActive ? "bg-navy-hover text-frost" : "text-frost/70 hover:bg-ink hover:text-frost"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <l.icon aria-hidden className={`h-[18px] w-[18px] ${isActive ? "text-gold" : "text-steel group-hover:text-frost/80"}`} />
                  {l.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 flex items-center gap-3 rounded-2xl bg-ink p-3 ring-1 ring-line">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/15 text-sm font-bold text-gold ring-1 ring-gold/30">{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="text-xs capitalize text-steel">{user.role}</div>
          </div>
          <IconButton icon={LogOut} label="Log out" onClick={logout} />
        </div>
        <VersionInfo className="px-5 pb-4" />
      </aside>

      {/* Phone / small-screen top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-deep print:hidden md:hidden">
        <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <Logo className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">ScanToPrint</div>
            <div className="text-[11px] tabular-nums text-steel">Version {__APP_VERSION__}</div>
          </div>
          <IconButton icon={LogOut} label="Log out" onClick={logout} />
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition ${
                  isActive ? "bg-gold text-midnight" : "text-frost/75 ring-1 ring-line hover:bg-ink"
                }`
              }
            >
              <l.icon aria-hidden className="h-4 w-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="min-w-0 flex-1">
        <UpdateBanner isOwner={user.role === "owner"} />
        <main className="p-4 sm:p-6 lg:p-8 print:p-0">
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
