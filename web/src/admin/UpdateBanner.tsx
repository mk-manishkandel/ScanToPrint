import { useEffect, useState } from "react";
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

  return (
    <div className="flex flex-wrap items-center gap-3 bg-gold px-6 py-2 text-sm text-midnight print:hidden">
      {info.state === "downloading" || info.state === "installing" ? (
        <span>Installing ScanToPrint {info.available}… the app will restart in a moment.</span>
      ) : info.state === "error" ? (
        <span>{info.error}</span>
      ) : (
        <>
          <span>
            <b>ScanToPrint {info.available}</b> is available (you have {info.current}).
          </span>
          {isOwner ? (
            <Button
              variant="secondary"
              className="!py-1"
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
            <span className="opacity-80">Ask the owner to install it.</span>
          )}
          {error && <span className="rounded bg-midnight/15 px-2">{error}</span>}
        </>
      )}
    </div>
  );
}
