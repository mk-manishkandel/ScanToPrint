import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, CheckCircle2, Circle, ClipboardCheck, Download, FolderOpen, Globe, Printer, QrCode, ScanLine, Upload, Wifi, type LucideIcon } from "lucide-react";
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

      <div className="grid items-start gap-6 xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)] print:block">
        {/* The poster: what gets printed. */}
        {url ? (
          <section
            aria-label="Poster preview"
            className="w-full max-w-lg rounded-3xl bg-ink mx-auto xl:sticky xl:top-8 xl:max-w-none px-6 py-10 text-center ring-1 ring-line animate-fade-in sm:px-10 print:max-w-none print:rounded-none print:bg-white print:py-16 print:text-black print:ring-0"
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

        {/* Settings and health: never printed. One column, same width, top to bottom. */}
        <div className="@container flex min-w-0 flex-col gap-6 print:hidden">
          <Card as="section">
            <SectionTitle icon={Globe} title="Portal address" hint="The address inside the QR code." />
            {sys.portal_urls.length === 0 ? (
              <div className="mt-4"><ErrorText error="This PC isn't connected to a network. Connect it to the shop Wi-Fi/router." /></div>
            ) : (
              <div className="mt-4 grid gap-x-6 gap-y-2 text-sm @2xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @2xl:items-center">
                <Select label="Portal address" value={url} onChange={setUrl} options={sys.portal_urls.map((u) => ({ value: u, label: u }))} />
                <p className="text-steel">
                  {sys.portal_urls.length > 1
                    ? "This PC has more than one network. Pick the one your shop Wi-Fi uses."
                    : "Customers open this address when they scan the code."}
                </p>
              </div>
            )}
          </Card>

          <section className="rounded-2xl bg-ink ring-1 ring-line">
            <div className="p-5 pb-0"><SectionTitle icon={Activity} title="System status" /></div>
            <dl className="mt-4 grid border-y border-line text-sm divide-y divide-line @lg:grid-cols-3 @lg:divide-x @lg:divide-y-0">
              <Stat label="Printing">
                {sys.print_backend === "sumatra" ? <Badge tone="green">Ready</Badge> : sys.print_backend === "mock" ? <Badge tone="amber">Test mode</Badge> : <Badge tone="red">Missing. Reinstall</Badge>}
              </Stat>
              <Stat label="Office files">
                {sys.libreoffice ? <Badge tone="green">Ready</Badge> : (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone="amber">LibreOffice missing</Badge>
                    <a className="inline-flex items-center gap-1 text-xs text-gold underline-offset-2 hover:underline" href="https://www.libreoffice.org/download/download-libreoffice/" target="_blank" rel="noreferrer">
                      <Download aria-hidden className="h-3.5 w-3.5" /> Download
                    </a>
                  </span>
                )}
              </Stat>
              <Stat label="Version"><span className="font-medium tabular-nums">{sys.version}</span></Stat>
            </dl>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-5 text-sm">
              <span className="text-steel">Files stored in</span>
              <code className="w-full min-w-0 break-all @md:w-auto @md:flex-1 rounded-lg bg-midnight px-2.5 py-1.5 text-xs text-frost/85">{sys.storage_dir}</code>
              {onShopPc && (
                <Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => api.post("/api/admin/storage/open").catch((e) => setError(e.message))}>
                  Open folder
                </Button>
              )}
            </div>
          </section>

          <Checklist activePrinters={activePrinters} hasUrl={!!url} />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="flex items-center gap-2 font-semibold"><Icon aria-hidden className="h-4 w-4 text-gold" /> {title}</h2>
      {hint && <span className="text-sm text-steel">{hint}</span>}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-steel">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/** What to do before the poster goes up, with live ticks where the app can tell. */
function Checklist({ activePrinters, hasUrl }: { activePrinters: number | null; hasUrl: boolean }) {
  const steps: { done: boolean | null; title: string; body: React.ReactNode; action?: React.ReactNode }[] = [
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
      action: activePrinters === 0 && (
        <Link to="/admin/printers" className="self-center whitespace-nowrap text-sm font-medium text-gold underline-offset-2 hover:underline">Open Printers</Link>
      ),
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
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="rounded-2xl bg-ink text-sm ring-1 ring-line">
      <div className="p-5 pb-4">
        <SectionTitle icon={ClipboardCheck} title="Before you put it up" hint={`${done} of ${steps.length} checked by the app`} />
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4 px-5 py-4">
            {s.done ? (
              <CheckCircle2 aria-label="Done" className="h-6 w-6 shrink-0 text-gold" />
            ) : (
              <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-steel ring-1 ring-line-strong">
                {s.done === false ? <Circle className="h-2.5 w-2.5 fill-danger text-danger" /> : i + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.title}</div>
              <div className="mt-1 text-steel">{s.body}</div>
            </div>
            {s.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
