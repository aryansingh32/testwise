import { API_URL, freshAccessToken } from '../api';

export interface NetworkResult {
  rttMs: number;
  downMbps: number;
  samples: number;
}

async function timed(path: string) {
  const token = await freshAccessToken();
  const t0 = Date.now();
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${token ?? ''}` } });
  const buf = await res.arrayBuffer();
  if (!res.ok) throw new Error(`netcheck ${res.status}`);
  return { ms: Math.max(1, Date.now() - t0), bytes: buf.byteLength };
}

/** Median round-trip delay over several tiny requests, plus download speed of a 256 KB payload (best of two). */
export async function measureNetwork(): Promise<NetworkResult> {
  const rtts: number[] = [];
  for (let i = 0; i < 6; i++) rtts.push((await timed('/v1/proctor/netcheck?bytes=0')).ms);
  rtts.sort((a, b) => a - b);
  const speeds: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await timed('/v1/proctor/netcheck?bytes=262144');
    speeds.push((r.bytes * 8) / (r.ms / 1000) / 1e6);
  }
  // Drop the first request of each kind's connection setup by taking the median / best.
  return { rttMs: rtts[Math.floor(rtts.length / 2)], downMbps: Math.max(...speeds), samples: rtts.length + speeds.length };
}
