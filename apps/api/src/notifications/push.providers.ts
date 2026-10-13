import { Logger } from '@nestjs/common';
import { createPrivateKey, sign, type KeyObject } from 'crypto';
import { readFileSync } from 'fs';
import http2 from 'http2';

export interface PushMessage {
  title: string;
  body: string;
  /** Android notification channel / iOS thread id. */
  category: string;
  data: Record<string, string>;
}

export type TokenResult = { token: string; ok: true } | { token: string; ok: false; invalid: boolean; error: string };

export interface PushSender {
  name: 'FCM' | 'APNS';
  isConfigured(): boolean;
  /** Human-readable reason when not configured (shown in admin). */
  configHint(): string;
  send(tokens: string[], msg: PushMessage): Promise<TokenResult[]>;
}

/**
 * Firebase Cloud Messaging (Android devices) via the Firebase Admin SDK.
 * Env: FIREBASE_SERVICE_ACCOUNT (JSON, or base64 of the JSON) or FIREBASE_SERVICE_ACCOUNT_PATH.
 */
export class FcmSender implements PushSender {
  name = 'FCM' as const;
  private readonly logger = new Logger('FCM');
  private messaging: import('firebase-admin/messaging').Messaging | null = null;
  private initError: string | null = null;

  private credentials(): Record<string, string> | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    try {
      if (raw) return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (path) return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      this.initError = `Invalid Firebase service account: ${(e as Error).message}`;
    }
    return null;
  }

  isConfigured() {
    return !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH) && !this.initError;
  }

  configHint() {
    return this.initError ?? (this.isConfigured() ? 'Configured' : 'Set FIREBASE_SERVICE_ACCOUNT (service account JSON) on the API server');
  }

  private async client() {
    if (this.messaging) return this.messaging;
    const creds = this.credentials();
    if (!creds) throw new Error(this.configHint());
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = getApps().find((a) => a.name === 'testwise') ?? initializeApp({ credential: cert(creds as never) }, 'testwise');
    this.messaging = getMessaging(app);
    return this.messaging;
  }

  async send(tokens: string[], msg: PushMessage): Promise<TokenResult[]> {
    const messaging = await this.client();
    const out: TokenResult[] = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: msg.title, body: msg.body },
        data: msg.data,
        android: { priority: 'high', notification: { channelId: msg.category.toLowerCase(), sound: 'default', color: '#F59E0B' } },
      });
      res.responses.forEach((r, j) => {
        if (r.success) out.push({ token: chunk[j], ok: true });
        else {
          const code = r.error?.code ?? 'unknown';
          const invalid = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(code);
          out.push({ token: chunk[j], ok: false, invalid, error: `${code}: ${r.error?.message ?? ''}`.slice(0, 300) });
        }
      });
    }
    return out;
  }
}

/**
 * Apple Push Notification service (iOS devices) over HTTP/2 with token auth.
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (contents of the .p8) or APNS_PRIVATE_KEY_PATH,
 * APNS_BUNDLE_ID (default app.testwise.student), APNS_PRODUCTION=true for App Store builds.
 */
export class ApnsSender implements PushSender {
  name = 'APNS' as const;
  private key: KeyObject | null = null;
  private jwt: { token: string; at: number } | null = null;

  isConfigured() {
    return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && (process.env.APNS_PRIVATE_KEY || process.env.APNS_PRIVATE_KEY_PATH));
  }

  configHint() {
    return this.isConfigured() ? 'Configured' : 'Set APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY (.p8) on the API server';
  }

  private bearer() {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.at < 50 * 60) return this.jwt.token;
    if (!this.key) {
      const pem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? readFileSync(process.env.APNS_PRIVATE_KEY_PATH!, 'utf8');
      this.key = createPrivateKey(pem);
    }
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM_ID, iat: now })}`;
    const signature = sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.jwt = { token: `${unsigned}.${signature}`, at: now };
    return this.jwt.token;
  }

  async send(tokens: string[], msg: PushMessage): Promise<TokenResult[]> {
    const host = process.env.APNS_PRODUCTION === 'true' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    const client = http2.connect(host);
    const topic = process.env.APNS_BUNDLE_ID ?? 'app.testwise.student';
    const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default', 'thread-id': msg.category }, ...msg.data });
    try {
      return await Promise.all(
        tokens.map(
          (token) =>
            new Promise<TokenResult>((resolve) => {
              const req = client.request({
                ':method': 'POST',
                ':path': `/3/device/${token}`,
                authorization: `bearer ${this.bearer()}`,
                'apns-topic': topic,
                'apns-push-type': 'alert',
                'apns-priority': '10',
                'content-type': 'application/json',
              });
              let status = 0;
              let body = '';
              req.on('response', (h) => (status = Number(h[':status'])));
              req.on('data', (c) => (body += c));
              req.on('end', () => {
                if (status === 200) return resolve({ token, ok: true });
                const reason = (() => { try { return JSON.parse(body).reason as string; } catch { return body; } })();
                resolve({ token, ok: false, invalid: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered', error: `${status} ${reason}`.slice(0, 300) });
              });
              req.on('error', (e) => resolve({ token, ok: false, invalid: false, error: e.message }));
              req.end(payload);
            }),
        ),
      );
    } finally {
      client.close();
    }
  }
}
