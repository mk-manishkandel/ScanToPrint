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
