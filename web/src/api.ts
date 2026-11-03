export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Can't reach the shop computer. Check you're on the shop Wi-Fi.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Error ${res.status}`);
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(url: string, headers?: Record<string, string>) => request<T>("GET", url, undefined, headers),
  post: <T>(url: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", url, body ?? {}, headers),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown, headers?: Record<string, string>) => request<T>("PATCH", url, body, headers),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export interface User {
  id: number;
  name: string;
  username: string;
  role: "owner" | "staff";
  active: boolean;
}

export interface Settings {
  shop_name: string;
  retention_days: number;
  max_file_mb: number;
  max_files_per_job: number;
  currency: string;
  price_bw_single: number;
  price_bw_duplex: number;
  price_color_single: number;
  price_color_duplex: number;
}

export interface ShopInfo {
  shop_name: string;
  currency: string;
  max_file_mb: number;
  max_files_per_job: number;
  version: string;
}

export type JobStatus =
  | "uploaded" | "submitted" | "queued" | "printing" | "ready" | "done" | "collected" | "failed" | "cancelled";

export interface JobFile {
  id: number;
  original_name: string;
  mime: string;
  size_bytes: number;
  page_count: number | null;
  conversion_status: "pending" | "ok" | "failed" | "unsupported";
  error: string | null;
}

export interface PrintRun {
  id: number;
  file_id: number;
  printer_id: number | null;
  printer_name: string | null;
  page_range: string | null;
  copies: number;
  color: boolean;
  duplex: boolean;
  paper_size: string;
  sheets: number;
  triggered_by: "customer" | "staff";
  status: "queued" | "printing" | "done" | "failed";
  error: string | null;
  created_at: string;
}

export interface Job {
  id: number;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  mode: "submit" | "self" | null;
  status: JobStatus;
  notes: string | null;
  total_pages: number;
  estimated_price: number;
  payment_status: "skipped" | "pending" | "paid";
  created_at: string;
  updated_at: string;
  files: JobFile[];
  runs?: PrintRun[];
}

export interface PrinterOption {
  id: number;
  display_name: string;
  supports_color: boolean;
  supports_duplex: boolean;
  paper_sizes: string[];
}

export interface AdminPrinter extends PrinterOption {
  system_name: string;
  is_active: boolean;
  allow_self_print: boolean;
  installed: boolean;
}

export interface PrintItem {
  file_id: number;
  page_range: string;
  copies: number;
  color: boolean;
  duplex: boolean;
  paper_size: string;
}

export interface PrintPlan {
  printer_id: number;
  items: (Omit<PrintItem, "page_range"> & { file_name: string; pages: number; quote: { sides: number; sheets: number; price: number } })[];
  total_sheets: number;
  total_price: number;
  currency: string;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  uploaded: "Not sent yet",
  submitted: "Waiting",
  queued: "In print queue",
  printing: "Printing",
  ready: "Ready to collect",
  done: "Printed",
  collected: "Collected",
  failed: "Problem",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<JobStatus, "slate" | "green" | "amber" | "red" | "blue" | "teal"> = {
  uploaded: "slate",
  submitted: "amber",
  queued: "blue",
  printing: "blue",
  ready: "green",
  done: "green",
  collected: "slate",
  failed: "red",
  cancelled: "slate",
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Reconnecting WebSocket; calls onEvent for every message. Returns a close function. */
export function liveEvents(path: string, onEvent: (e: { type: string; job_id?: number; new?: boolean }) => void, onReconnect?: () => void) {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.onopen = () => {
      if (delay > 1000) onReconnect?.();
      delay = 1000;
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
