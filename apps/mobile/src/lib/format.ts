import { pickLang } from '@testwise/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from './session';

/** Returns a picker for bilingual fields, falling back to English. */
export function useLocalized() {
  const { language } = useSession();
  return <T extends string | null | undefined>(en: T, hi: T) => pickLang(en, hi, language);
}

/** Re-renders every second while mounted; used for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useCountdown(target: string | number | Date) {
  const now = useNow();
  const { t } = useTranslation();
  const ms = Math.max(0, new Date(target).getTime() - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = d > 0 ? `${d}${t('time.d')} ${h}${t('time.h')} ${pad(m)}${t('time.m')}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return { ms, done: ms === 0, label, parts: { d, h, m, s: sec } };
}

export function formatDateTime(iso: string, lang: 'EN' | 'HI') {
  return new Date(iso).toLocaleString(lang === 'HI' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Client-generated idempotency key so retries never create duplicate orders. */
export function newKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}
