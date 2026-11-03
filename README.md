# ScanToPrint

QR-code document printing for stationery and print shops.

A QR code stands at the counter. Customers scan it with their phone, upload documents (PDF, photos, Word, Excel, PowerPoint…) and either:

- **Submit for Print**: the job appears instantly on the shop dashboard, and staff open the file and print it, or
- **Print by Yourself**: the customer picks one of the shop's activated printers, chooses pages, copies, colour and sides, and the job prints straight away.

Payment is a placeholder step for now (always "skipped").

Everything runs on the **shop's Windows PC**. Customers connect over the shop Wi-Fi, and no internet or cloud account is needed.

---

## For shop owners

### Install
1. Download **`ScanToPrint_x.y.z_x64-setup.exe`** from the [latest release](https://github.com/mk-manishkandel/ScanToPrint/releases/latest).
2. Run it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. The installer isn't code-signed yet; this is expected.
3. Open ScanToPrint and follow the setup wizard: shop name, owner password, printers.
4. For Word/Excel/PowerPoint files, install [LibreOffice](https://www.libreoffice.org/download/) when the app asks. PDFs and photos work without it.
5. In your Wi-Fi router, **reserve a fixed IP address** for this PC, so the QR code keeps working.
6. In Windows, set the shop Wi-Fi network to **Private**.
7. Print the QR poster (tray icon → **Show QR Code**) and put it at the counter.

### Day to day
- ScanToPrint starts with Windows and lives in the **system tray** (bottom-right). Closing the window does **not** stop it. Use tray → **Quit** to stop it.
- Staff can also open the dashboard from any device on the Wi-Fi at `http://<PC-IP>:8080/admin`.
- Customer files are stored in `C:\ProgramData\ScanToPrint\storage` and deleted automatically after the number of days set in Settings (default 7).
- **Updates:** when a new version is out, a banner appears in the dashboard. The owner clicks **Install & restart**. Installing waits until nothing is printing.

### Troubleshooting
| Problem | Fix |
|---|---|
| Customers can't open the page | Their phone must be on the shop Wi-Fi. Check the Wi-Fi is set to **Private** in Windows. Make sure the PC's IP matches the QR poster (reserve it on the router). |
| Word/Excel files say "can't convert" | Install LibreOffice, then click **Retry convert** on the job. |
| A print failed | Check the printer is on and has paper, then use **Print…** on the job again. |
| Tray tooltip says "NOT RUNNING" | Another program is using port 8080. Close it and restart ScanToPrint. |
| Anything else | Logs are in `C:\ProgramData\ScanToPrint\logs`. |

---

## For developers

### Stack
| Part | Tech |
|---|---|
| Desktop shell, tray, installer, auto-update | Tauri 2 (`src-tauri/`) |
| Server, API, conversion, printing | Rust: Axum + tokio + SQLite/sqlx (`crates/core/`) |
| Customer portal and admin UI | React + Vite + Tailwind (`web/`), embedded into the binary |
| Printing | SumatraPDF (bundled sidecar, GPLv3, pinned + checksum-verified) |
| Office → PDF | LibreOffice headless (installed separately on the shop PC) |

### Prerequisites
- Rust (the version is pinned in `rust-toolchain.toml`; `rustup` installs it automatically)
- Node.js 22+

### Run locally (any OS)
```bash
npm ci
npm run web:build                       # build the UI once (embedded by the server)
cargo run -p scantoprint-core --bin dev-server   # http://localhost:8080, data in ./data
# For UI hot reload, also run:
npm run web:dev                         # http://localhost:5173 (proxies /api → :8080)
```
Desktop app in dev mode: `npm run tauri dev`. On macOS, printing uses a mock printer.

### Checks (same as CI)
```bash
node scripts/check-versions.mjs
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm run web:build
```

---

## Releasing an update

> ⚠️ Read this before every release. These rules keep auto-update working for every installed shop.

1. **Bump the version in all four places** (CI fails if they differ):
   `src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`), `package.json`, `web/package.json`.
   Then run `cargo check` so `Cargo.lock` updates, and commit.
2. **Create and push a signed tag**: `git tag -s v1.2.3 -m "v1.2.3" && git push origin main v1.2.3`
3. GitHub Actions builds the installer, signs the update and creates a **draft release**.
4. Download the `.exe` from the draft and **test it on a Windows PC**, including updating from the previous version.
5. Click **Publish release**. Installed apps pick up the update within about 6 hours, or on their next start.

### Never do these
- **Never change** `identifier` (`com.mkmanishkandel.scantoprint`) in `tauri.conf.json`. Installs and updates are matched by it.
- **Never edit a database migration that has been released.** Add a new migration file instead.
- **Never change the default port 8080.** It is printed on every shop's QR poster.
- **Never commit** the updater private key, its password, `.env` files or certificates.
- **Never lose the updater signing key.** Without it, no installed copy can ever be updated again.

### Signing
| What | How | Where the secret lives |
|---|---|---|
| Git commits and tags | SSH signing key `~/.ssh/scantoprint_signing` (repo-local git config) | Developer machine; public key registered on GitHub as a *signing* key |
| App updates | Tauri updater key (minisign) | Private key + password in GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, plus an **offline backup**. The public key is in `tauri.conf.json` |
| Windows installer (Authenticode) | Not yet. Add later with `bundle.windows.signCommand` | — |

Rotating the updater key is only possible by shipping a release signed with the **old** key that contains the **new** public key.

---

## Third-party software
- **SumatraPDF** © Krzysztof Kowalczyk et al., GPLv3. It is bundled unmodified as a separate program. See `src-tauri/binaries/SumatraPDF-LICENSE.txt`.
- **LibreOffice** is not bundled; shop owners install it themselves.
