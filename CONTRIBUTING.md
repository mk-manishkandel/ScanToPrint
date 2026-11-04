# Contributing to ScanToPrint

Thanks for helping! Bug reports, ideas, translations, docs and code are all welcome.

## Ways to help
- **Report a bug or request a feature:** open an [issue](https://github.com/mk-manishkandel/ScanToPrint/issues/new/choose). Please include your Windows version, your printer model and the relevant log lines from `C:\ProgramData\ScanToPrint\logs`.
- **Security problems:** please follow [SECURITY.md](SECURITY.md) and don't open a public issue.
- **Code:** for anything bigger than a small fix, open an issue first so we can agree on the approach.

## Development setup

You need Rust (the version is pinned in `rust-toolchain.toml`; `rustup` installs it automatically) and Node.js 22+.

```bash
git clone https://github.com/mk-manishkandel/ScanToPrint.git
cd ScanToPrint
npm ci
npm run web:build
cargo run -p scantoprint-core --bin dev-server   # http://localhost:8080
npm run web:dev                                  # optional: UI hot reload on :5173
```

The full desktop app (tray icon, auto-start, updater) runs with `npm run tauri dev`.

You can develop on macOS or Linux. Printing uses a **mock printer** there, which saves files to `data/mock-printer/` instead of printing. Real printing through SumatraPDF only runs on Windows. CI builds and tests on both Windows and macOS.

## Project layout

| Path | What |
|---|---|
| `crates/core/` | The server: HTTP API, database, file conversion, printing. Most logic and tests live here. |
| `crates/core/migrations/` | Database migrations (see the rules below). |
| `src-tauri/` | Desktop shell: window, tray, auto-start, auto-update, installer config. |
| `web/` | React + Tailwind UI: customer portal (`src/customer`) and staff dashboard (`src/admin`). |
| `scripts/` | Version check and the SumatraPDF download script. |

## Before you open a pull request

Run the same checks as CI:

```bash
node scripts/check-versions.mjs
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm run web:build
```

- Add or update tests in `crates/core` for behaviour changes.
- Keep PRs focused, one change per PR.
- Describe what you tested, especially anything printer-related on real Windows hardware.

## Rules that protect installed shops

These keep auto-updates safe for every shop running ScanToPrint:

- **Never edit a released migration** in `crates/core/migrations/`. Add a new numbered file instead.
- **Don't change** the bundle `identifier` in `src-tauri/tauri.conf.json`, or the default port `8080`. Printed QR posters depend on the port.
- New settings go in `crates/core/src/settings.rs` with a default value, so no migration is needed.
- Customer endpoints must always check the job token (`authorize` in `http/customer.rs`).

## Design: Royal Navy & Gold

The UI uses one dark palette, defined as Tailwind tokens in `web/src/index.css`. Use these token classes (for example `bg-ink`, `text-steel`, `border-line`), not raw Tailwind colours such as `slate-*` or `red-*`.

| Token | Hex | Use |
|---|---|---|
| `midnight` | `#0B1426` | Main page background |
| `ink` | `#16233D` | Cards, panels, form fields |
| `deep` | `#070E1C` | Deepest areas: sidebar, overlays, loading |
| `frost` | `#EEF0F5` | Main text and headings (`frost/80` for body text) |
| `steel` | `#8A94A8` | Secondary text, labels, captions |
| `gold` | `#D4AF6A` | Accent: primary buttons, links, highlights, logo |
| `gold-soft` | `#E6CC97` | Gold on hover |
| `cobalt` | `#365496` | "Info" badge fill only, never text |
| `danger` | `#E0796B` | Errors and invalid fields |
| `navy-hover` | `#1C2C4B` | Hover colour for navy cards |
| `line` / `line-strong` | frost at 12% / 24% | Dividers and borders |

- Text on a gold background is `text-midnight`, never white.
- **No glow effects:** no coloured shadows, blurred light spots, pulsing rings or gradient backgrounds. Use flat fills and one thin border/ring.
- For gold rings and borders, use gold at 25–50% opacity (`ring-gold/25`). Avoid gold-tinted *fills* on navy, because they look muddy; use `bg-midnight/60` with a gold ring instead.
- **Solid surfaces.** Cards, panels, fields and bars use solid token colours (`bg-ink`, `bg-midnight`, `bg-deep`), never see-through ones like `bg-ink/80`, and no `backdrop-blur`. On some Windows graphics drivers, WebView2 draws large see-through layers as green-grey patches. The only exception is the dimmed backdrop behind a pop-up.
- **One stroke per element.** Text fields show focus by turning their own border gold; don't add a ring or outline on top.
- The printed QR poster must stay black on white (`print:` classes), so it doesn't waste toner.
- **Type:** DM Sans, bundled via `@fontsource-variable/dm-sans`. Don't load fonts from the internet; shops may be offline, and the CSP blocks it. Use `tabular-nums` for job codes, prices and counts.
- **Icons:** `lucide-react` only. No emoji as icons. Decorative icons get `aria-hidden`, and icon-only buttons use `IconButton`, which requires a `label`.
- **Touch:** controls are at least 44px tall (`min-h-11`). Use the shared components in `web/src/components/ui.tsx` (`Button`, `Segmented`, `Stepper`, `Switch`, `Sheet`, `EmptyState`…) instead of one-off styles.
- **Motion:** use the short `animate-fade-in` / `animate-rise` / `animate-sheet-up` tokens. They are switched off automatically for reduced-motion users.
- An option a printer can't do (e.g. colour) stays visible but disabled, with the reason, rather than disappearing.

## Commit signing

`main` only accepts signed commits. If you open a PR, a maintainer squash-merges it and GitHub signs the merge commit, so you don't need to set up signing yourself.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
