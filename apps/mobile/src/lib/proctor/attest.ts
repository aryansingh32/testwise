import type { AttestationEvidence, PublicAppConfig } from '@testwise/shared';
import { Platform } from 'react-native';
import { api } from '../api';
import { storage } from '../storage';

type Policy = PublicAppConfig['proctoring.policy'];
type AppIntegrity = typeof import('@expo/app-integrity');

function lib(): AppIntegrity | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('@expo/app-integrity') as AppIntegrity;
  } catch {
    return null;
  }
}

export interface Challenge {
  challengeId: string;
  challenge: string;
}

export const fetchChallenge = () => api<Challenge>('/v1/proctor/attest/challenge', { method: 'POST', body: { purpose: 'PREFLIGHT' } });

let providerReady = false;

async function androidToken(challenge: string, policy: Policy): Promise<AttestationEvidence | null> {
  const L = lib();
  if (!L || !policy.attestationCloudProjectNumber) return null;
  const request = async () => L.requestIntegrityCheckAsync(challenge);
  if (!providerReady) {
    await L.prepareIntegrityTokenProviderAsync(policy.attestationCloudProjectNumber);
    providerReady = true;
  }
  try {
    return { platform: 'android', token: await request() };
  } catch (e) {
    // The provider expires after a while; prepare a new one once and retry.
    if (String((e as { code?: string }).code ?? e).includes('PROVIDER_INVALID')) {
      await L.prepareIntegrityTokenProviderAsync(policy.attestationCloudProjectNumber);
      return { platform: 'android', token: await request() };
    }
    throw e;
  }
}

/** One App Attest key per account on this install: attested once, then used for a signed assertion on every exam. */
const keyStore = (userId: string) => `tw_attest_key:${userId}`;
type StoredKey = { keyId: string; confirmed: boolean };

async function iosEvidence(userId: string, challenge: string): Promise<AttestationEvidence | null> {
  const L = lib();
  if (!L || !L.isSupported) return null;
  const raw = await storage.get(keyStore(userId));
  const stored: StoredKey | null = raw ? JSON.parse(raw) : null;
  if (stored?.confirmed) {
    return { platform: 'ios', keyId: stored.keyId, assertion: await L.generateAssertionAsync(stored.keyId, challenge) };
  }
  // Apple allows attesting a key exactly once, so a key that was attested but never confirmed by our server is replaced.
  const keyId = await L.generateKeyAsync();
  const attestation = await L.attestKeyAsync(keyId, challenge);
  await storage.set(keyStore(userId), JSON.stringify({ keyId, confirmed: false } satisfies StoredKey));
  return { platform: 'ios', keyId, attestation };
}

export async function confirmAttestedKey(userId: string) {
  const raw = await storage.get(keyStore(userId));
  if (!raw) return;
  const k = JSON.parse(raw) as StoredKey;
  if (!k.confirmed) await storage.set(keyStore(userId), JSON.stringify({ ...k, confirmed: true }));
}

export async function forgetAttestedKey(userId: string) {
  await storage.remove(keyStore(userId));
}

/** Platform proof bound to a fresh server challenge. Null when the device cannot attest (the server then blocks or flags it). */
export async function attest(userId: string, challenge: string, policy: Policy): Promise<AttestationEvidence | null> {
  try {
    return Platform.OS === 'android' ? await androidToken(challenge, policy) : Platform.OS === 'ios' ? await iosEvidence(userId, challenge) : null;
  } catch {
    return null;
  }
}
