import {
  useEffect, useId, useRef,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import {
  AlertCircle, Check, File, FileImage, FileSpreadsheet, FileText, Loader2, Minus, Plus, Presentation, X, type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ buttons */

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-gold text-midnight hover:bg-gold-soft active:bg-gold disabled:bg-navy-hover disabled:text-steel",
  secondary:
    "bg-ink text-frost ring-1 ring-inset ring-line-strong hover:bg-navy-hover hover:ring-gold/40 active:bg-navy-hover disabled:text-steel disabled:ring-line",
  danger: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/40 hover:bg-danger/20 active:bg-danger/25 disabled:opacity-50",
  ghost: "text-frost/85 hover:bg-navy-hover hover:text-frost active:bg-navy-hover disabled:text-steel",
};
const SIZE: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "min-h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "min-h-14 px-5 text-base gap-2.5 rounded-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  loading,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex cursor-pointer select-none items-center justify-center font-semibold transition duration-150 ease-out disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : Icon ? <Icon aria-hidden className="h-[1.1em] w-[1.1em] shrink-0" /> : null}
      {children}
    </button>
  );
}

/** Square icon-only button with a 44px hit area and a required accessible name. */
export function IconButton({
  icon: Icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-steel transition hover:bg-navy-hover hover:text-frost active:bg-navy-hover disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <Icon aria-hidden className="h-5 w-5" />
    </button>
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Card({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <Tag className={`rounded-2xl bg-ink/90 p-5 ring-1 ring-line ${className}`}>{children}</Tag>;
}

export function PageHeader({ title, description, actions, icon: Icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-gold ring-1 ring-gold/25">
            <Icon aria-hidden className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-steel">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong bg-ink/40 px-6 py-14 text-center animate-fade-in">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink text-gold ring-1 ring-gold/25">
        <Icon aria-hidden className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 max-w-md text-sm text-steel">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-frost/90">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle aria-hidden className="h-3.5 w-3.5" /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-steel">{hint}</span>
      ) : null}
    </label>
  );
}

const FIELD =
  "w-full min-w-0 rounded-xl border border-line-strong bg-midnight/60 px-3.5 text-base text-frost outline-none transition placeholder:text-steel/70 hover:border-gold/40 focus:border-gold aria-[invalid=true]:border-danger disabled:opacity-60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} min-h-11 py-2.5 ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} min-h-11 cursor-pointer py-2.5 ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD} min-h-24 py-3 ${props.className ?? ""}`} />;
}

/** Radio group styled as a segmented control. Disabled options stay visible with a reason. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: LucideIcon; disabled?: boolean }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-steel">{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-midnight/70 p-1 ring-1 ring-inset ring-line">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              className={`relative flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition ${
                o.disabled
                  ? "cursor-not-allowed text-steel/50"
                  : on
                    ? "cursor-pointer bg-gold text-midnight"
                    : "cursor-pointer text-frost/80 hover:bg-navy-hover hover:text-frost"
              } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold/70`}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={on}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              {o.icon && <o.icon aria-hidden className="h-4 w-4" />}
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Stepper({ label, value, min = 1, max = 100, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-steel">{label}</div>
      <div className="flex items-center rounded-xl bg-midnight/70 ring-1 ring-inset ring-line">
        <IconButton icon={Minus} label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
        <output aria-live="polite" className="flex-1 text-center text-base font-semibold tabular-nums">{value}</output>
        <IconButton icon={Plus} label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
      </div>
    </div>
  );
}

/** Accessible on/off switch. */
export function Switch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 text-left transition hover:bg-navy-hover"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-steel">{description}</span>}
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-gold" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-frost shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ feedback */

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger ring-1 ring-danger/30 animate-fade-in">
      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </p>
  );
}

export function Notice({ icon: Icon, children, className = "" }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl bg-midnight/60 px-4 py-3 text-sm text-gold-soft ring-1 ring-gold/25 ${className}`}>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className = "h-5 w-5", label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={`animate-spin text-gold ${className}`} />;
}

type Tone = "slate" | "green" | "amber" | "red" | "blue" | "teal";
const TONE: Record<Tone, string> = {
  slate: "bg-frost/8 text-steel ring-line",
  green: "bg-gold text-midnight ring-gold",
  amber: "bg-gold/12 text-gold ring-gold/40",
  red: "bg-danger/12 text-danger ring-danger/40",
  blue: "bg-cobalt/40 text-frost ring-cobalt",
  teal: "bg-gold/12 text-gold-soft ring-gold/30",
};
const DOT: Record<Tone, string> = {
  slate: "bg-steel",
  green: "bg-midnight",
  amber: "bg-gold",
  red: "bg-danger",
  blue: "bg-frost",
  teal: "bg-gold-soft",
};

export function Badge({ children, tone = "slate", dot = true }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[tone]}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

/** Small neutral chip for print settings (e.g. "Colour", "2 copies"). */
export function Chip({ icon: Icon, children, accent }: { icon?: LucideIcon; children: ReactNode; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${accent ? "bg-gold/12 text-gold ring-gold/30" : "bg-midnight/60 text-frost/85 ring-line"}`}>
      {Icon && <Icon aria-hidden className="h-3 w-3" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ modal sheet */

/**
 * Dialog that slides up from the bottom on phones and is centred on larger screens.
 * Traps focus, closes on Escape or backdrop tap, locks page scroll, restores focus on close.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    (focusables()[1] ?? focusables()[0] ?? panel)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-deep/85 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[94dvh] w-full flex-col rounded-t-3xl bg-ink shadow-2xl shadow-black/60 ring-1 ring-line outline-none animate-sheet-up sm:rounded-3xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
        <header className="flex items-start gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-steel">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2 -mt-1" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <footer className="border-t border-line px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ brand + misc */

/** Brand mark: a navy orb with a gold ring and a gold printer glyph. */
export function Logo({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full ring-1 ring-gold/40 bg-ink ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-gold" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 9V3h10v6" />
        <rect x="3" y="9" width="18" height="8" rx="2" />
        <path d="M7 14h10v7H7z" />
      </svg>
    </span>
  );
}

const EXT_ICON: [RegExp, LucideIcon][] = [
  [/\.(jpe?g|png|webp|bmp|gif|tiff?|heic|heif)$/i, FileImage],
  [/\.(xlsx?|ods|csv)$/i, FileSpreadsheet],
  [/\.(pptx?|odp|ppsx?)$/i, Presentation],
  [/\.(pdf|docx?|odt|rtf|txt)$/i, FileText],
];

export function FileIcon({ name, className = "" }: { name: string; className?: string }) {
  const Icon = EXT_ICON.find(([re]) => re.test(name))?.[1] ?? File;
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-midnight/70 text-gold ring-1 ring-line ${className}`}>
      <Icon aria-hidden className="h-5 w-5" />
    </span>
  );
}

/** "Step 2 of 3" progress for multi-step flows. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label={`Step ${current + 1} of ${steps.length}`} className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={s} aria-current={on ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                done ? "bg-gold text-midnight" : on ? "bg-midnight text-gold ring-2 ring-gold" : "bg-midnight/60 text-steel ring-1 ring-line"
              }`}
            >
              {done ? <Check aria-hidden className="h-4 w-4" /> : i + 1}
            </span>
            <span className={`truncate text-xs font-medium ${on ? "text-frost" : "text-steel"}`}>{s}</span>
            {i < steps.length - 1 && <span aria-hidden className={`h-px min-w-3 flex-1 ${done ? "bg-gold/60" : "bg-line"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
