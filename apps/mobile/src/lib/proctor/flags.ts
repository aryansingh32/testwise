import type { ProctorFlagInput } from '@testwise/shared';
import { API_URL, api, freshAccessToken } from '../api';

export type EvidenceFile = { uri: string; name: string; type: string };

/** Report a flag. The server owns severity/points/warnings; the device only says what it saw. */
export async function sendFlag(attemptId: string, flag: Omit<ProctorFlagInput, 'details'> & { details?: ProctorFlagInput['details'] }, evidence: EvidenceFile[] = []) {
  const payload = { ...flag, details: flag.details ?? {}, clientAt: new Date().toISOString() };
  if (!evidence.length) {
    await api(`/v1/proctor/attempts/${attemptId}/flags`, { method: 'POST', body: payload });
    return;
  }
  const form = new FormData();
  form.append('data', JSON.stringify(payload));
  for (const f of evidence.slice(0, 2)) form.append('evidence', f as unknown as Blob);
  await upload(`/v1/proctor/attempts/${attemptId}/flags`, form);
}

export async function sendSnapshot(attemptId: string, file: EvidenceFile, faces: number | null) {
  const form = new FormData();
  form.append('image', file as unknown as Blob);
  if (faces !== null) form.append('faces', String(faces));
  await upload(`/v1/proctor/attempts/${attemptId}/snapshot`, form);
}

async function upload(path: string, form: FormData) {
  const token = await freshAccessToken();
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token ?? ''}` }, body: form });
  if (!res.ok) throw new Error(`upload failed ${res.status}`);
}
