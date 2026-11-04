import { useEffect, useState } from "react";
import { Activity, Download, FolderOpen, Globe, Lightbulb, Printer, QrCode, ScanLine, Upload, Wifi } from "lucide-react";
import { api, type ShopInfo } from "../api";
import { Badge, Button, Card, ErrorText, PageHeader, Select, Spinner } from "../components/ui";

interface SystemInfo {
  version: string;
  portal_urls: string[];
  port: number;
  libreoffice: boolean;
  print_backend: "sumatra" | "mock" | "missing";
  storage_dir: string;
}

const onShopPc = ["localhost", "127.0.0.1"].includes(location.hostname);

export default function QrPoster() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SystemInfo>("/api/admin/system").then((s) => {
      setSys(s);
      setUrl(s.portal_urls[0] ?? "");
    }, (e) => setError(e.message));
    api.get<ShopInfo>("/api/shop").then(setShop);
  }, []);

  if (!sys) return error ? <ErrorText error={error} /> : <div className="grid place-items-center py-20"><Spinner className="h-7 w-7" /></div>;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          icon={QrCode}
          title="QR poster"
          description="Print this and put it at the counter. Customers must be on the shop Wi-Fi."
          actions={<Button icon={Printer} onClick={() => window.print()} disabled={!url}>Print poster</Button>}
        />
      </div>
      <div className="print:hidden"><ErrorText error={error} /></div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem] print:block">
        {/* The poster: what gets printed. */}
        {url ? (
          <section
            aria-label="Poster preview"
            className="mx-auto w-full max-w-lg rounded-3xl 2xl:max-w-2xl 2xl:py-14 bg-ink px-6 py-10 text-center ring-1 ring-line animate-fade-in sm:px-10 print:max-w-none print:rounded-none print:bg-white print:py-16 print:text-black print:ring-0"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-gold print:text-black">Scan · Upload · Print</div>
            <div className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl 2xl:text-5xl">{shop?.shop_name}</div>
            <div className="mt-2 text-base text-frost/80 sm:text-lg print:text-black">Print your documents from your phone</div>
            <div className="mx-auto my-8 w-fit rounded-2xl bg-white p-4 ring-2 ring-gold print:ring-black">
              <img className="block w-56 sm:w-64 2xl:w-80 print:w-80" alt={`QR code for ${url}`} src={`/api/admin/qr.svg?url=${encodeURIComponent(url)}`} />
            </div>
            <ol className="mx-auto grid max-w-md grid-cols-3 gap-2 text-sm 2xl:max-w-lg 2xl:text-base">
              {([[Wifi, "Join our Wi-Fi"], [ScanLine, "Scan the code"], [Upload, "Upload & print"]] as const).map(([Icon, t], i) => (
                <li key={t} className="flex flex-col items-center gap-2">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-midnight text-gold ring-1 ring-gold/50 print:bg-white print:text-black print:ring-2 print:ring-black">
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                  <span className="leading-tight"><span className="font-semibold text-gold print:text-black">{i + 1}.</span> {t}</span>
                </li>
              ))}
            </ol>
            <div className="mt-8 border-t border-line pt-4 text-xs text-steel print:border-black/20 print:text-black">
              or open <span className="break-all font-medium text-frost/85 print:text-black">{url}</span>
            </div>
          </section>
        ) : (
          <Card className="text-sm text-steel">Connect this PC to the shop network to make a poster.</Card>
        )}

        {/* Settings and health: never printed. */}
        <div className="space-y-4 print:hidden">
          <Card as="section" className="space-y-3 text-sm">
            <h2 className="flex items-center gap-2 font-semibold"><Globe aria-hidden className="h-4 w-4 text-gold" /> Portal address</h2>
            {sys.portal_urls.length === 0 ? (
              <ErrorText error="This PC isn't connected to a network. Connect it to the shop Wi-Fi/router." />
            ) : (
              <label className="block">
                <span className="sr-only">Portal address</span>
                <Select value={url} onChange={(e) => setUrl(e.target.value)}>
                  {sys.portal_urls.map((u) => <option key={u}>{u}</option>)}
                </Select>
              </label>
            )}
            <p className="flex gap-2 text-steel">
              <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <span>In your router settings, <b className="font-semibold text-frost">reserve this IP address</b> for this PC so the QR code keeps working after restarts.</span>
            </p>
          </Card>

          <Card as="section" className="text-sm">
            <h2 className="flex items-center gap-2 font-semibold"><Activity aria-hidden className="h-4 w-4 text-gold" /> System status</h2>
            <dl className="mt-3 divide-y divide-line">
              <Row label="Printing">
                {sys.print_backend === "sumatra" ? <Badge tone="green">Ready</Badge> : sys.print_backend === "mock" ? <Badge tone="amber">Test mode</Badge> : <Badge tone="red">Missing. Reinstall</Badge>}
              </Row>
              <Row label="Office files">
                {sys.libreoffice ? <Badge tone="green">Ready</Badge> : (
                  <span className="flex flex-col items-end gap-1">
                    <Badge tone="amber">LibreOffice missing</Badge>
                    <a className="inline-flex items-center gap-1 text-xs text-gold underline-offset-2 hover:underline" href="https://www.libreoffice.org/download/download-libreoffice/" target="_blank" rel="noreferrer">
                      <Download aria-hidden className="h-3.5 w-3.5" /> Download LibreOffice
                    </a>
                  </span>
                )}
              </Row>
              <Row label="Version"><span className="tabular-nums">{sys.version}</span></Row>
            </dl>
            <div className="mt-3 border-t border-line pt-3">
              <div className="text-steel">Files stored in</div>
              <code className="mt-1.5 block break-all rounded-lg bg-midnight px-2.5 py-2 text-xs text-frost/85">{sys.storage_dir}</code>
              {onShopPc && (
                <Button variant="secondary" size="sm" icon={FolderOpen} className="mt-2 w-full" onClick={() => api.post("/api/admin/storage/open").catch((e) => setError(e.message))}>
                  Open folder
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-steel">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
