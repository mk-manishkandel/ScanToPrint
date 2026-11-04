import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Circle, ClipboardCheck, Download, FolderOpen, Globe, Printer, QrCode, ScanLine, Upload, Wifi } from "lucide-react";
import { api, type AdminPrinter, type ShopInfo } from "../api";
import { Badge, Button, Card, ErrorText, PageHeader, Spinner } from "../components/ui";
import { Select } from "../components/pickers";

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
  const [activePrinters, setActivePrinters] = useState<number | null>(null);

  useEffect(() => {
    // Owner-only list; staff just don't get the live tick.
    api.get<AdminPrinter[]>("/api/admin/printers").then((p) => setActivePrinters(p.filter((x) => x.is_active).length), () => {});
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

      <div className="grid items-start gap-6 lg:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)] print:block">
        {/* The poster: what gets printed. */}
        {url ? (
          <section
            aria-label="Poster preview"
            className="w-full max-w-lg rounded-3xl bg-ink px-6 py-10 text-center ring-1 ring-line animate-fade-in sm:px-10 print:max-w-none print:rounded-none print:bg-white print:py-16 print:text-black print:ring-0"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-gold print:text-black">Scan · Upload · Print</div>
            <div className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{shop?.shop_name}</div>
            <div className="mt-2 text-base text-frost/80 sm:text-lg print:text-black">Print your documents from your phone</div>
            <div className="mx-auto my-8 w-fit rounded-2xl bg-white p-4 ring-2 ring-gold print:ring-black">
              <img className="block w-56 sm:w-64 print:w-80" alt={`QR code for ${url}`} src={`/api/admin/qr.svg?url=${encodeURIComponent(url)}`} />
            </div>
            <ol className="mx-auto grid max-w-md grid-cols-3 gap-2 text-sm">
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
        <div className="grid items-start gap-4 print:hidden xl:grid-cols-2">
          <Card as="section" className="space-y-3 text-sm">
            <h2 className="flex items-center gap-2 font-semibold"><Globe aria-hidden className="h-4 w-4 text-gold" /> Portal address</h2>
            {sys.portal_urls.length === 0 ? (
              <ErrorText error="This PC isn't connected to a network. Connect it to the shop Wi-Fi/router." />
            ) : (
              <Select label="Portal address" value={url} onChange={setUrl} options={sys.portal_urls.map((u) => ({ value: u, label: u }))} />
            )}
            <p className="text-steel">
              {sys.portal_urls.length > 1
                ? "This PC has more than one network. Pick the one your shop Wi-Fi uses."
                : "Customers open this address when they scan the code."}
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

          <Checklist activePrinters={activePrinters} hasUrl={!!url} />
        </div>
      </div>
    </div>
  );
}

/** What to do before the poster goes up, with live ticks where the app can tell. */
function Checklist({ activePrinters, hasUrl }: { activePrinters: number | null; hasUrl: boolean }) {
  const steps: { done: boolean | null; title: string; body: React.ReactNode }[] = [
    {
      done: hasUrl,
      title: "Connect this PC to the shop network",
      body: "Use the same router as your customer Wi-Fi. In Windows, set that network to Private so phones can reach this PC.",
    },
    {
      done: null,
      title: "Reserve this PC's IP address",
      body: "In your router settings, reserve the address above for this PC. Otherwise it can change after a restart and the printed code stops working.",
    },
    {
      done: activePrinters === null ? null : activePrinters > 0,
      title: "Turn on at least one printer",
      body: activePrinters ? `${activePrinters} printer${activePrinters === 1 ? " is" : "s are"} on.` : "Go to Printers, scan, and switch a printer on.",
    },
    {
      done: null,
      title: "Test it with your phone",
      body: "Join the shop Wi-Fi, scan the code on screen, and upload a photo. It should appear in the print queue with a sound.",
    },
    {
      done: null,
      title: "Print and put it up",
      body: "Place it at eye level by the counter, where customers wait.",
    },
  ];
  return (
    <Card as="section" className="text-sm xl:col-span-2">
      <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck aria-hidden className="h-4 w-4 text-gold" /> Before you put it up</h2>
      <ol className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            {s.done ? (
              <CheckCircle2 aria-label="Done" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            ) : (
              <span aria-hidden className="grid h-5 w-5 shrink-0 translate-y-0.5 place-items-center rounded-full text-[11px] font-bold text-steel ring-1 ring-line-strong">
                {s.done === false ? <Circle className="h-2 w-2 fill-danger text-danger" /> : i + 1}
              </span>
            )}
            <div>
              <div className="font-medium">{s.title}</div>
              <div className="mt-0.5 text-steel">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
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
