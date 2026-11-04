import { useEffect, useState } from "react";
import { Activity, Download, FolderOpen, Globe, Lightbulb, Printer, QrCode, ScanLine, Upload, Wifi } from "lucide-react";
import { api, type ShopInfo } from "../api";
import { Badge, Button, Card, ErrorText, Notice, PageHeader, Select, Spinner } from "../components/ui";

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
      <ErrorText error={error} />
      <div className="grid gap-4 print:hidden lg:grid-cols-2">
        <Card as="section" className="space-y-3 text-sm">
          <h2 className="flex items-center gap-2 font-semibold"><Activity aria-hidden className="h-4 w-4 text-gold" /> System status</h2>
          <Row label="Printing">
            {sys.print_backend === "sumatra" ? <Badge tone="green">Ready</Badge> : sys.print_backend === "mock" ? <Badge tone="amber">Test mode (not Windows)</Badge> : <Badge tone="red">Print component missing. Reinstall</Badge>}
          </Row>
          <Row label="Word / Excel / PowerPoint">
            {sys.libreoffice ? <Badge tone="green">LibreOffice found</Badge> : (
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <Badge tone="amber">LibreOffice not installed</Badge>
                <a className="inline-flex items-center gap-1 text-gold underline-offset-2 hover:underline" href="https://www.libreoffice.org/download/download-libreoffice/" target="_blank" rel="noreferrer">
                  <Download aria-hidden className="h-3.5 w-3.5" /> Get it
                </a>
              </span>
            )}
          </Row>
          <div className="border-t border-line pt-3">
            <div className="text-steel">Files stored in</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-midnight/70 px-2.5 py-1.5 text-xs text-frost/85 ring-1 ring-line">{sys.storage_dir}</code>
              {onShopPc && (
                <Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => api.post("/api/admin/storage/open").catch((e) => setError(e.message))}>
                  Open folder
                </Button>
              )}
            </div>
          </div>
          <Row label="Version"><span className="tabular-nums">{sys.version}</span></Row>
        </Card>
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
          <Notice icon={Lightbulb}>
            In your router settings, <b>reserve this IP address</b> for this PC so the QR code keeps working after restarts.
          </Notice>
        </Card>
      </div>
      {url && (
        <div className="relative mx-auto max-w-xl overflow-hidden rounded-[2rem] bg-gradient-to-b from-navy-hover via-ink to-midnight p-10 text-center ring-1 ring-gold/40 animate-pop print:max-w-none print:rounded-none print:bg-none print:bg-white print:text-black print:ring-0">
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-gold/15 blur-3xl print:hidden" />
          <div className="relative text-xs font-semibold uppercase tracking-[0.3em] text-gold print:text-black">Scan · Upload · Print</div>
          <div className="relative mt-2 text-4xl font-bold tracking-tight">{shop?.shop_name}</div>
          <div className="relative mt-2 text-lg text-frost/85 print:text-black">Print your documents from your phone</div>
          <div className="relative mx-auto my-8 w-fit rounded-3xl bg-white p-4 shadow-[0_20px_60px_-20px_rgba(212,175,106,0.5)] ring-4 ring-gold/60 print:shadow-none print:ring-2 print:ring-black">
            <img className="w-72" alt={`QR code for ${url}`} src={`/api/admin/qr.svg?url=${encodeURIComponent(url)}`} />
          </div>
          <ol className="relative mx-auto grid max-w-md grid-cols-3 gap-3 text-sm">
            {([[Wifi, "Join our Wi-Fi"], [ScanLine, "Scan the code"], [Upload, "Upload & print"]] as const).map(([Icon, t], i) => (
              <li key={t} className="flex flex-col items-center gap-2">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-gold text-midnight print:bg-white print:text-black print:ring-2 print:ring-black">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span><span className="font-semibold text-gold print:text-black">{i + 1}.</span> {t}</span>
              </li>
            ))}
          </ol>
          <div className="relative mt-8 text-xs text-steel print:text-black">or open <span className="font-medium text-frost/85 print:text-black">{url}</span></div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-steel">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
