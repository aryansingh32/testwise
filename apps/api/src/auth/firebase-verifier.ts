import { readFileSync } from 'node:fs';
import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  name: string | null;
  provider: string;
}

/**
 * Verifies Firebase ID tokens on the server. Verification needs only the project id (Google's public keys); a service
 * account is optional here and is used when present. The app is never trusted to say who the user is: it can only
 * present a token that Google signed for this project.
 */
@Injectable()
export class FirebaseVerifier {
  private readonly logger = new Logger('FirebaseAuth');
  private auth: import('firebase-admin/auth').Auth | null = null;

  projectId() {
    if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? (process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8') : null);
      if (!raw) return null;
      const j = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      return (j.project_id as string) ?? null;
    } catch {
      return null;
    }
  }

  isConfigured() {
    return !!this.projectId();
  }

  private async client() {
    if (this.auth) return this.auth;
    const projectId = this.projectId();
    if (!projectId) throw new ServiceUnavailableException('Sign-in with Google or phone is not configured on the server (FIREBASE_PROJECT_ID)');
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const app = getApps().find((a) => a.name === 'testwise-auth') ?? initializeApp({ projectId }, 'testwise-auth');
    this.auth = getAuth(app);
    return this.auth;
  }

  async verify(idToken: string): Promise<VerifiedFirebaseUser> {
    const auth = await this.client();
    try {
      const d = await auth.verifyIdToken(idToken);
      return {
        uid: d.uid,
        email: d.email ?? null,
        emailVerified: d.email_verified === true,
        phone: d.phone_number ?? null,
        name: (d.name as string | undefined) ?? null,
        provider: d.firebase?.sign_in_provider ?? 'unknown',
      };
    } catch (e) {
      this.logger.warn(`ID token rejected: ${(e as Error).message}`);
      throw new UnauthorizedException('Sign-in could not be verified. Try again.');
    }
  }
}
