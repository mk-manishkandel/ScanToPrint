/**
 * Themed replacements for the browser's <select> and <input type="date">, whose menus and
 * calendars can't be styled. Both keep keyboard focus on their trigger button and render their
 * menu in a portal, so they work inside scrolling sheets and dialogs.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

const TRIGGER =
  "relative flex min-h-11 w-full min-w-0 cursor-pointer items-center rounded-xl border border-line-strong bg-midnight py-2.5 pl-3.5 pr-11 text-left text-base text-frost outline-none transition hover:border-gold/40 focus-visible:border-gold aria-expanded:border-gold disabled:cursor-not-allowed disabled:opacity-60";
const MENU = "fixed z-[60] overflow-auto rounded-xl bg-ink p-1.5 shadow-xl shadow-black/50 ring-1 ring-line-strong animate-fade-in";

/** Places a fixed-position menu under (or, if there's no room, above) its trigger, and keeps it there. */
function useAnchored(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, onClose: () => void, matchWidth: boolean) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const m = menu.current;
    if (!a || !m) return;
    const gap = 6;
    const margin = 8;
    const width = matchWidth ? a.width : m.offsetWidth;
    const below = window.innerHeight - a.bottom - gap - margin;
    const above = a.top - gap - margin;
    const natural = m.scrollHeight;
    const up = natural > below && above > below;
    const maxHeight = Math.max(120, Math.min(natural, up ? above : below));
    const left = Math.min(Math.max(margin, a.left), window.innerWidth - width - margin);
    setStyle({
      left,
      width: matchWidth ? width : undefined,
      maxHeight,
      top: up ? a.top - gap - maxHeight : a.bottom + gap,
    });
  }, [anchor, menu, matchWidth]);

  useLayoutEffect(() => {
    if (!open) return setStyle({ visibility: "hidden" });
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !menu.current?.contains(t)) onClose();
    };
    // Follow the trigger when the page or a sheet scrolls; close if it scrolls out of view.
    const onMove = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a || a.bottom < 0 || a.top > window.innerHeight) onClose();
      else place();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, anchor, menu, onClose, place]);

  return style;
}

/* ------------------------------------------------------------------ select */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = "",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name when there's no visible <Field> label wrapping it. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const style = useAnchored(open, button, list, close, true);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const typed = useRef({ text: "", at: 0 });

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      if (!open) show();
      setActive(Math.min(last, Math.max(0, i)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(open ? active + 1 : selected);
      case "ArrowUp":
        return move(open ? active - 1 : selected);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "Enter":
      case " ":
        e.preventDefault();
        return open ? pick(active) : show();
      case "Escape":
        if (open) {
          // Close just the menu, not a sheet around it.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        if (open) pick(active);
        return;
      default:
        // Type-to-jump, like a native select.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
          const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
          if (i >= 0) {
            if (open) setActive(i);
            else onChange(options[i].value);
          }
        }
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`${TRIGGER} ${className}`}
      >
        <span className="truncate">{options[selected]?.label ?? ""}</span>
        <ChevronDown aria-hidden className={`pointer-events-none absolute right-3.5 h-4 w-4 text-steel transition-transform ${open ? "rotate-180 text-gold" : ""}`} />
      </button>
      {open &&
        createPortal(
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} tabIndex={-1} style={style} className={MENU}>
            {options.map((o, i) => {
              const on = i === selected;
              return (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
                  onClick={() => {
                    pick(i);
                    button.current?.focus();
                  }}
                  className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-navy-hover" : ""} ${on ? "text-gold" : "text-frost/90"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${on ? "font-semibold" : ""}`}>{o.label}</span>
                    {o.description && <span className="block text-xs text-steel">{o.description}</span>}
                  </span>
                  <Check aria-hidden className={`h-4 w-4 shrink-0 ${on ? "" : "invisible"}`} />
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ date picker */

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const days = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), days));
};

/** Pick a single day. `value`/`onChange` use "YYYY-MM-DD" (local time); "" means no date. */
export function DatePicker({
  value,
  onChange,
  label = "Date",
  placeholder = "Any date",
  max,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  /** Latest selectable day, "YYYY-MM-DD". */
  max?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = fromIso(value);
  const [cursor, setCursor] = useState<Date>(chosen ?? today);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const style = useAnchored(open, button, panel, close, false);
  const limit = max ? fromIso(max) : null;
  const allowed = (d: Date) => !limit || d <= limit;

  const show = () => {
    setCursor(chosen ?? today);
    setOpen(true);
  };
  const pick = (d: Date | null) => {
    if (d && !allowed(d)) return;
    onChange(d ? toIso(d) : "");
    setOpen(false);
    button.current?.focus();
  };

  // Focus moves into the calendar while it's open, and the cursor day keeps focus as it moves.
  // (Waits until the menu has been positioned: a hidden element can't take focus.)
  const placed = style.visibility !== "hidden";
  useEffect(() => {
    if (open && placed) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${toIso(cursor)}"]`)?.focus();
  }, [open, placed, cursor]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weekdays = Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(undefined, { weekday: "narrow" }));
  const monthName = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function onGridKey(e: React.KeyboardEvent) {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => addDays(cursor, -((cursor.getDay() + 6) % 7)),
      End: () => addDays(cursor, 6 - ((cursor.getDay() + 6) % 7)),
    };
    if (step[e.key]) {
      e.preventDefault();
      setCursor(step[e.key]());
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${chosen ? chosen.toLocaleDateString() : placeholder}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
        className={`${TRIGGER} ${className}`}
      >
        <span className={`truncate ${chosen ? "" : "text-steel/70"}`}>
          {chosen ? chosen.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : placeholder}
        </span>
        <Calendar aria-hidden className={`pointer-events-none absolute right-3.5 h-4 w-4 ${open ? "text-gold" : "text-steel"}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={`Choose ${label.toLowerCase()}`}
            style={style}
            className={`${MENU} w-[18.5rem] !p-3`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
              }
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <NavButton label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </NavButton>
              <div id={`${id}-month`} aria-live="polite" className="text-sm font-semibold">{monthName}</div>
              <NavButton label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </NavButton>
            </div>
            <div role="grid" aria-labelledby={`${id}-month`} ref={grid} onKeyDown={onGridKey} className="mt-2">
              <div role="row" className="grid grid-cols-7">
                {weekdays.map((w, i) => (
                  <div key={i} role="columnheader" className="grid h-8 place-items-center text-[11px] font-medium uppercase text-steel">{w}</div>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, r) => (
                <div key={r} role="row" className="grid grid-cols-7">
                  {days.slice(r * 7, r * 7 + 7).map((d) => {
                    const iso = toIso(d);
                    const inMonth = d.getMonth() === cursor.getMonth();
                    const isSel = chosen && iso === toIso(chosen);
                    const isToday = iso === toIso(today);
                    const ok = allowed(d);
                    return (
                      <div key={iso} role="gridcell" aria-selected={!!isSel} className="grid place-items-center p-0.5">
                        <button
                          type="button"
                          data-day={iso}
                          tabIndex={iso === toIso(cursor) ? 0 : -1}
                          disabled={!ok}
                          aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                          aria-current={isToday ? "date" : undefined}
                          onClick={() => pick(d)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              pick(d);
                            }
                          }}
                          className={`grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-sm tabular-nums outline-none transition focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-30 ${
                            isSel
                              ? "bg-gold font-semibold text-midnight"
                              : isToday
                                ? "text-gold ring-1 ring-gold/50 hover:bg-navy-hover"
                                : inMonth
                                  ? "text-frost/90 hover:bg-navy-hover"
                                  : "text-steel/50 hover:bg-navy-hover"
                          }`}
                        >
                          {d.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button type="button" onClick={() => pick(null)} className="min-h-9 cursor-pointer rounded-lg px-2.5 text-sm text-steel hover:bg-navy-hover hover:text-frost">
                Clear
              </button>
              <button type="button" onClick={() => pick(today)} className="min-h-9 cursor-pointer rounded-lg px-2.5 text-sm font-semibold text-gold hover:bg-navy-hover">
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-steel transition hover:bg-navy-hover hover:text-frost">
      {children}
    </button>
  );
}
