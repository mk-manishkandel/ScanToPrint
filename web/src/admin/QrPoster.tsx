import { useEffect, useState } from "react";
import { api, type ShopInfo } from "../api";
import { Badge, Button, Card, ErrorText, Spinner } from "../components/ui";

interface SystemInfo {
  version: string;
  portal_urls: string[];
  port: number;
  libreoffice: boolean;
  print_backend: "sumatra" | "mock" | "missing";
  storage_dir: string;
}

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

  if (!sys) return error ? <ErrorText error={error} /> : <Spinner />;

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold">QR poster</h1>
        <p className="text-sm text-steel">Print this and place it at the counter. Customers must be on the shop Wi-Fi.</p>
      </div>
      <div className="grid gap-4 print:hidden lg:grid-cols-2">
        <Card className="space-y-2 text-sm">
          <h2 className="font-semibold">Status</h2>
          <Row label="Printing">
            {sys.print_backend === "sumatra" ? <Badge tone="green">Ready</Badge> : sys.print_backend === "mock" ? <Badge tone="amber">Test mode (not Windows)</Badge> : <Badge tone="red">Print component missing — reinstall</Badge>}
          </Row>
          <Row label="Word / Excel / PowerPoint">
            {sys.libreoffice ? <Badge tone="green">LibreOffice found</Badge> : (
              <span>
                <Badge tone="amber">LibreOffice not installed</Badge>{" "}
                <a className="text-gold underline" href="https://www.libreoffice.org/download/download-libreoffice/" target="_blank" rel="noreferrer">Download</a>
              </span>
            )}
          </Row>
          <Row label="Files stored in"><code className="text-xs">{sys.storage_dir}</code></Row>
          <Row label="Version">{sys.version}</Row>
        </Card>
        <Card className="space-y-3 text-sm">
          <h2 className="font-semibold">Portal address</h2>
          {sys.portal_urls.length === 0 ? (
            <ErrorText error="This PC isn't connected to a network. Connect it to the shop Wi-Fi/router." />
          ) : (
            <select className="w-full rounded-lg border border-line-strong bg-ink px-3 py-2" value={url} onChange={(e) => setUrl(e.target.value)}>
              {sys.portal_urls.map((u) => <option key={u}>{u}</option>)}
            </select>
          )}
          <p className="text-steel">
            Tip: in your router settings, <b>reserve this IP address</b> for this PC so the QR code keeps working after restarts.
          </p>
          <Button onClick={() => window.print()} disabled={!url}>Print poster</Button>
        </Card>
      </div>
      {url && (
        <div className="mx-auto max-w-xl rounded-3xl bg-ink p-10 text-center ring-1 ring-gold/25 print:max-w-none print:bg-white print:text-black print:ring-0">
          <div className="text-3xl font-black">{shop?.shop_name}</div>
          <div className="mt-2 text-xl font-semibold text-gold print:text-black">Scan to print your documents</div>
          <img className="mx-auto my-6 w-80 rounded-2xl bg-white p-3" alt="QR code" src={`/api/admin/qr.svg?url=${encodeURIComponent(url)}`} />
          <ol className="mx-auto max-w-sm space-y-1 text-left text-lg">
            <li>1. Connect to our Wi-Fi</li>
            <li>2. Scan this code with your camera</li>
            <li>3. Upload your files — submit or print yourself</li>
          </ol>
          <div className="mt-6 text-sm text-steel">or open {url}</div>
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
