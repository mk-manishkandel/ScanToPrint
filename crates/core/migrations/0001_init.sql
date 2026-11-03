-- ScanToPrint schema v1.
-- RULE: once a release ships, never edit this file. Add 0002_*.sql etc. instead.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('owner', 'staff')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE printers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    system_name      TEXT    NOT NULL UNIQUE,
    display_name     TEXT    NOT NULL,
    is_active        INTEGER NOT NULL DEFAULT 0,
    allow_self_print INTEGER NOT NULL DEFAULT 0,
    supports_color   INTEGER NOT NULL DEFAULT 0,
    supports_duplex  INTEGER NOT NULL DEFAULT 0,
    paper_sizes      TEXT    NOT NULL DEFAULT '["A4"]',
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL,
    token_hash      TEXT    NOT NULL,
    customer_name   TEXT,
    customer_phone  TEXT,
    mode            TEXT    CHECK (mode IN ('submit', 'self')),
    status          TEXT    NOT NULL DEFAULT 'uploaded' CHECK (status IN
                    ('uploaded','submitted','queued','printing','ready','done','collected','failed','cancelled')),
    notes           TEXT,
    total_pages     INTEGER NOT NULL DEFAULT 0,
    estimated_price REAL    NOT NULL DEFAULT 0,
    payment_status  TEXT    NOT NULL DEFAULT 'skipped' CHECK (payment_status IN ('skipped','pending','paid')),
    handled_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    storage_dir     TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX jobs_status_idx  ON jobs(status);
CREATE INDEX jobs_created_idx ON jobs(created_at);
CREATE INDEX jobs_code_idx    ON jobs(code);

CREATE TABLE job_files (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    original_name     TEXT    NOT NULL,
    mime              TEXT    NOT NULL,
    size_bytes        INTEGER NOT NULL,
    original_path     TEXT    NOT NULL,
    pdf_path          TEXT,
    page_count        INTEGER,
    conversion_status TEXT    NOT NULL DEFAULT 'pending' CHECK (conversion_status IN ('pending','ok','failed','unsupported')),
    error             TEXT,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX job_files_job_idx ON job_files(job_id);

CREATE TABLE print_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    file_id      INTEGER NOT NULL REFERENCES job_files(id) ON DELETE CASCADE,
    printer_id   INTEGER REFERENCES printers(id) ON DELETE SET NULL,
    page_range   TEXT,
    copies       INTEGER NOT NULL DEFAULT 1,
    color        INTEGER NOT NULL DEFAULT 0,
    duplex       INTEGER NOT NULL DEFAULT 0,
    paper_size   TEXT    NOT NULL DEFAULT 'A4',
    sheets       INTEGER NOT NULL DEFAULT 0,
    triggered_by TEXT    NOT NULL CHECK (triggered_by IN ('customer','staff')),
    status       TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','done','failed')),
    error        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX print_runs_job_idx ON print_runs(job_id);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
