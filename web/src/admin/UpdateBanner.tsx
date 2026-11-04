import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui";

const INFO_EVENT = "stp:update-info";

interface UpdateInfo {
  current: string;
  supported: boolean;
  available: string | null;
  notes: string | null;
  state: "idle" | "checking" | "downloading" | "installing" | "error";
  error: string | null;
}

export default function UpdateBanner({ isOwner }: { isOwner: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.get<UpdateInfo>("/api/admin/update").then(setInfo, () => {});
    load();
    const t = setInterval(load, info?.state === "downloading" ? 3000 : 15 * 60 * 1000);
    // "Check for updates" (VersionInfo) shares what it finds so the banner shows at once.
    const onInfo = (e: Event) => setInfo((e as CustomEvent<UpdateInfo>).detail);
    window.addEventListener(INFO_EVENT, onInfo);
    return () => {
      clearInterval(t);
      window.removeEventListener(INFO_EVENT, onInfo);
    };
  }, [info?.state]);

  if (!info?.supported || (!info.available && info.state !== "error")) return null;
  const working = info.state === "downloading" || info.state === "installing";

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-gold/30 bg-ink px-4 py-2.5 text-sm sm:px-6 print:hidden">
      {working ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin text-gold" /> Installing ScanToPrint {info.available}. The app will restart in a moment.
        </span>
      ) : info.state === "error" ? (
        <span className="inline-flex items-center gap-2 text-danger">
          <AlertTriangle aria-hidden className="h-4 w-4" /> {info.error}
        </span>
      ) : (
        <>
          <ArrowUpCircle aria-hidden className="h-4 w-4 text-gold" />
          <span>
            <b className="text-gold">ScanToPrint {info.available}</b> is available <span className="text-steel">(you have {info.current})</span>
          </span>
          {isOwner ? (
            <Button
              size="sm"
              onClick={() =>
                api.post("/api/admin/update/install").then(
                  () => setInfo({ ...info, state: "downloading" }),
                  (e) => setError(e.message),
                )
              }
            >
              Install & restart
            </Button>
          ) : (
            <span className="text-steel">Ask the owner to install it.</span>
          )}
          {error && <span className="text-danger">{error}</span>}
        </>
      )}
    </div>
  );
}

/**
 * "Version 0.1.4 · Check for updates". Shows the version of the screens you're looking at;
 * if the app behind them is newer (an update installed but this window is old), offers a reload.
 */
export function VersionInfo({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.get<UpdateInfo>("/api/admin/update").then(setInfo, () => {});
  }, []);

  async function check() {
    setChecking(true);
    setResult(null);
    try {
      await api.post("/api/admin/update/check");
      // The app asks GitHub; poll until it has an answer (about a second or two).
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const next = await api.get<UpdateInfo>("/api/admin/update");
        if (next.state !== "checking") {
          setInfo(next);
          window.dispatchEvent(new CustomEvent(INFO_EVENT, { detail: next }));
          setResult(next.available ? `Version ${next.available} is available` : "You have the latest version");
          return;
        }
      }
      setResult("No answer. Check the internet connection.");
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const stale = info && info.current !== __APP_VERSION__;
  return (
    <div className={`text-xs text-steel ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          Version <span className="font-semibold tabular-nums text-frost/85">{__APP_VERSION__}</span>
        </span>
        {info?.supported && (
          <button
            type="button"
            onClick={check}
            disabled={checking}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 text-gold hover:text-gold-soft disabled:cursor-wait disabled:text-steel"
          >
            <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
      {result && (
        <div role="status" className="mt-1 flex items-center gap-1.5 text-frost/80">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-gold" /> {result}
        </div>
      )}
      {stale && (
        <button type="button" onClick={() => location.reload()} className="mt-1 cursor-pointer text-gold underline-offset-2 hover:underline">
          Version {info.current} is installed. Reload to see it
        </button>
      )}
    </div>
  );
}
