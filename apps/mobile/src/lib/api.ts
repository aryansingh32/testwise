import type { AuthResponse } from '@testwise/shared';
import Constants from 'expo-constants';
import { storage } from './storage';

const TOKEN_KEY = 'tw_session';

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: { path: string; message: string }[] = [],
    /** Machine code and extra fields from the server body, e.g. PROCTOR_CHECK_REQUIRED + mode. */
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** Server request id (also in the `x-request-id` header): quote it to support to find the exact server log line. */
  requestId?: string;

  /** True for failures worth retrying or waiting out: no connection, timeout, overload (429/502/503/504). */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

const REQUEST_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS) || 20_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before retry n (0-based): the server's Retry-After if given (capped), otherwise exponential backoff with jitter. */
function backoffMs(attempt: number, res?: Response | null) {
  const ra = Number(res?.headers.get('retry-after'));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 5) * 1000;
  return 400 * 2 ** attempt + Math.random() * 250;
}

/** fetch with a timeout, so a dead mobile connection fails instead of hanging the screen forever. */
async function fetchWithTimeout(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokens: Tokens | null = null;
let onSignedOut: (() => void) | null = null;

export async function loadTokens() {
  const raw = await storage.get(TOKEN_KEY);
  tokens = raw ? (JSON.parse(raw) as Tokens) : null;
  return tokens;
}

export async function saveSession(r: AuthResponse) {
  tokens = { accessToken: r.accessToken, refreshToken: r.refreshToken };
  await storage.set(TOKEN_KEY, JSON.stringify(tokens));
}

export async function clearSession() {
  const rt = tokens?.refreshToken;
  tokens = null;
  await storage.remove(TOKEN_KEY);
  if (rt) {
    fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => undefined);
  }
}

/** Current access token, refreshed first if it is close to expiry (used by the duel socket). */
export async function freshAccessToken(): Promise<string | null> {
  if (!tokens) return null;
  try {
    const payload = JSON.parse(atob(tokens.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number };
    if (payload.exp * 1000 - Date.now() < 60_000) await refresh(); // a transient failure keeps the current token; the server decides
  } catch {
    /* malformed token: let the server reject it */
  }
  return tokens?.accessToken ?? null;
}

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

type RefreshResult = 'ok' | 'rejected' | 'unavailable';
let refreshing: Promise<RefreshResult> | null = null;

/**
 * 'rejected' only when the server definitively refuses the refresh token (400/401/403): that is the one case to sign out.
 * A network failure, timeout, 429 or 5xx means "try again later" and must NOT end the session (a student mid-exam would
 * otherwise be thrown to the login screen by one dropped packet at the moment their 15-minute token expires).
 */
async function refresh(): Promise<RefreshResult> {
  if (!tokens) return 'rejected';
  refreshing ??= (async (): Promise<RefreshResult> => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens!.refreshToken }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) return 'rejected';
      if (!res.ok) return 'unavailable';
      await saveSession((await res.json()) as AuthResponse);
      return 'ok';
    } catch {
      return 'unavailable';
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; /** Safe to repeat (the server de-duplicates it): enables automatic retry on transient failures. GETs always are. */ idempotent?: boolean } = {},
  retry = true,
): Promise<T> {
  const method = init.method ?? 'GET';
  const canRetry = method === 'GET' || init.idempotent === true;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.auth !== false && tokens) headers.authorization = `Bearer ${tokens.accessToken}`;

  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchWithTimeout(`${API_URL}${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
    } catch {
      res = null; // offline, DNS failure, or timeout
    }
    const transient = res === null || RETRYABLE_STATUS.has(res.status);
    if (!transient || !canRetry || attempt >= MAX_RETRIES) break;
    await sleep(backoffMs(attempt, res));
  }
  if (!res) throw new ApiError('offline', 0);

  if (res.status === 401 && retry && tokens && init.auth !== false) {
    const outcome = await refresh();
    if (outcome === 'ok') return api<T>(path, init, false);
    if (outcome === 'rejected') {
      await clearSession();
      onSignedOut?.();
    } else {
      // Could not reach the server to refresh: keep the session and report a retryable failure instead of signing out.
      throw new ApiError('offline', 0);
    }
  }
  if (!res.ok) {
    let body: { message?: string | string[]; issues?: { path: string; message: string }[]; code?: string; mode?: string; requestId?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON (e.g. a proxy error page) */
    }
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText;
    const err = new ApiError(msg, res.status, body.issues, body.code, body as Record<string, unknown>);
    err.requestId = body.requestId ?? res.headers.get('x-request-id') ?? undefined;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
