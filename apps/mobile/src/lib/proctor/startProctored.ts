import { router } from 'expo-router';
import { ApiError } from '../api';

export type ProctorTarget = { kind: 'test'; ref: string } | { kind: 'tournament'; ref: string };

/** True (and opens the device check) when the server says this start needs a proctoring clearance. */
export function routeToDeviceCheck(e: unknown, target: ProctorTarget): boolean {
  if (!(e instanceof ApiError) || e.code !== 'PROCTOR_CHECK_REQUIRED') return false;
  router.push({ pathname: '/exam/check', params: { kind: target.kind, ref: target.ref, mode: String(e.data?.mode ?? 'BASIC'), features: JSON.stringify(e.data?.features ?? {}) } });
  return true;
}
