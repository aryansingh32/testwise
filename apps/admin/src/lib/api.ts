export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const BASE = API_BASE;
const STORAGE_KEY = 'tw_admin_session';

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: string[];
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: { message?: string | string[]; issues?: unknown[]; changedFields?: string[]; requestId?: string } | null,
  ) {
    super(message);
  }

  /** Server request id: quote it to find the exact server log line. */
  get requestId() {
    return this.body?.requestId;
  }

  /** No connection, timeout, or overload (429/502/503/504): worth retrying, not a bug in the request. */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }

  /** Human-readable lines for validation errors. */
  get details(): string[] {
    const issues = (this.body?.issues ?? []) as ({ path?: string; message?: string } | string)[];
    return issues.map((i) => (typeof i === 'string' ? i : `${i.path ? i.path + ': ' : ''}${i.message}`));
  }
}

let session: AdminSession | null = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
})();

const listeners = new Set<(s: AdminSession | null) => void>();

export function getSession() {
  return session;
}

export function setSession(s: AdminSession | null) {
  session = s;
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
  listeners.forEach((l) => l(s));
}

export function onSessionChange(fn: (s: AdminSession | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoffMs(attempt: number, res?: Response | null) {
  const ra = Number(res?.headers.get('retry-after'));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 5) * 1000;
  return 400 * 2 ** attempt + Math.random() * 250;
}

/** fetch with a timeout so a stalled connection fails instead of leaving the screen spinning forever. */
async function fetchWithTimeout(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

type RefreshResult = 'ok' | 'rejected' | 'unavailable';
let refreshing: Promise<RefreshResult> | null = null;

/** Sign out only when the server definitively refuses the refresh token; a network error or 5xx/429 must not end the session. */
async function refresh(): Promise<RefreshResult> {
  if (!session) return 'rejected';
  refreshing ??= (async (): Promise<RefreshResult> => {
    try {
      const res = await fetchWithTimeout(`${BASE}/v1/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        setSession(null);
        return 'rejected';
      }
      if (!res.ok) return 'unavailable';
      setSession(await res.json());
      return 'ok';
    } catch {
      return 'unavailable';
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function parseError(res: Response): Promise<ApiError> {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? res.statusText;
  return new ApiError(msg, res.status, body ? { requestId: res.headers.get('x-request-id') ?? undefined, ...body } : { requestId: res.headers.get('x-request-id') ?? undefined });
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; /** Safe to repeat: retry on transient failures. GETs always are. */ idempotent?: boolean } = {}, retry = true): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const canRetry = method === 'GET' || init.idempotent === true;
  const headers = new Headers(init.headers);
  if (session) headers.set('authorization', `Bearer ${session.accessToken}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchWithTimeout(`${BASE}${path}`, { ...init, headers, body });
    } catch {
      res = null; // offline, CORS/DNS failure, or timeout
    }
    const transient = res === null || RETRYABLE_STATUS.has(res.status);
    if (!transient || !canRetry || attempt >= MAX_RETRIES) break;
    await sleep(backoffMs(attempt, res));
  }
  if (!res) throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, null);
  if (res.status === 401 && retry && session) {
    const outcome = await refresh();
    if (outcome === 'ok') return api<T>(path, init, false);
    if (outcome === 'unavailable') throw new ApiError('The server is busy. Your session is kept; please try again in a moment.', 0, null);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export async function download(path: string, fileName: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string) {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, null);
  }
  if (!res.ok) throw await parseError(res);
  setSession(await res.json());
}

export async function logout() {
  if (session) {
    await fetch(`${BASE}/v1/admin/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
  }
  setSession(null);
}

export const can = (permission: string) => !!session?.admin.permissions.includes(permission);
