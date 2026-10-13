#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const concurrency = Math.min(1000, Math.max(1, Number(process.env.CONCURRENCY ?? 1000)));
const target = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) && process.env.ALLOW_REMOTE_LOAD_TEST !== '1') {
  throw new Error('Load test is limited to localhost. Set ALLOW_REMOTE_LOAD_TEST=1 only for an environment you own.');
}

const samples = [];
let completed = 0;
let failed = 0;
const failuresByStatus = new Map();

async function virtualUser() {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    samples.push(performance.now() - started);
    completed++;
    if (!response.ok) {
      failed++;
      failuresByStatus.set(String(response.status), (failuresByStatus.get(String(response.status)) ?? 0) + 1);
    }
  } catch (error) {
    samples.push(performance.now() - started);
    failed++;
    const code = error?.cause?.code ?? error?.name ?? 'unknown';
    failuresByStatus.set(String(code), (failuresByStatus.get(String(code)) ?? 0) + 1);
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => virtualUser()));
const elapsedSeconds = (performance.now() - startedAt) / 1000;
samples.sort((a, b) => a - b);
const percentile = (p) => samples.length ? Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]) : null;
const result = {
  baseUrl,
  endpoint: 'GET /health (PostgreSQL + Redis dependency check)',
  concurrency,
  elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
  requests: completed,
  failures: failed,
  failuresByStatus: Object.fromEntries(failuresByStatus),
  requestsPerSecond: Number((completed / elapsedSeconds).toFixed(1)),
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: samples.length ? Math.round(samples.at(-1)) : null },
};
console.log(JSON.stringify(result, null, 2));
if (failed) process.exitCode = 1;
