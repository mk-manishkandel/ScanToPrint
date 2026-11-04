import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-gold text-midnight hover:bg-gold-soft disabled:bg-navy-hover disabled:text-steel",
    secondary: "bg-ink text-frost ring-1 ring-line-strong hover:bg-navy-hover hover:ring-gold/40 disabled:text-steel",
    danger: "bg-danger text-deep hover:bg-danger/85 disabled:bg-navy-hover disabled:text-steel",
    ghost: "text-frost hover:bg-navy-hover",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-frost">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-steel">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full min-w-0 rounded-lg border border-line-strong bg-ink px-3 py-2.5 text-base text-frost outline-none placeholder:text-steel/70 hover:border-gold/40 aria-[invalid=true]:border-danger focus:border-gold focus:ring-2 focus:ring-gold/25 ${props.className ?? ""}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-ink p-5 ring-1 ring-line ${className}`}>{children}</div>;
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/30">{error}</p>;
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "teal" }) {
  const t = {
    slate: "bg-frost/10 text-steel",
    green: "bg-gold text-midnight",
    amber: "bg-gold/15 text-gold ring-1 ring-inset ring-gold/40",
    red: "bg-danger/15 text-danger ring-1 ring-inset ring-danger/40",
    blue: "bg-cobalt/50 text-frost",
    teal: "bg-gold/15 text-gold-soft",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

/** Brand mark: a navy orb with a gold ring and a gold printer glyph. */
export function Logo({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full ring-1 ring-gold/40 shadow-[0_0_24px_rgba(212,175,106,0.18)] ${className}`}
      style={{ background: "radial-gradient(circle at 50% 40%, #1E2F52, #0B1426 75%)" }}
    >
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-gold" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 9V3h10v6" />
        <rect x="3" y="9" width="18" height="8" rx="2" />
        <path d="M7 14h10v7H7z" />
      </svg>
    </span>
  );
}
