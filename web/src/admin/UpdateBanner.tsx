import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Loader2 } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui";

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
    return () => clearInterval(t);
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
