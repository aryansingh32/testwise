import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';

/**
 * Tokens for live proctoring rooms on a LiveKit SFU (one room per proctor session).
 * The student device may only publish camera + microphone; admins may only subscribe.
 */
@Injectable()
export class LiveKitService {
  get url() {
    return process.env.LIVEKIT_URL ?? '';
  }

  isConfigured() {
    return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  }

  room(key: string) {
    return `proctor-${key}`;
  }

  private async token(identity: string, name: string, room: string, grants: { canPublish: boolean; canSubscribe: boolean }, ttlSeconds: number) {
    if (!this.isConfigured()) throw new ServiceUnavailableException('Live video is not configured on the server (LIVEKIT_URL / API key / secret)');
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name, ttl: ttlSeconds });
    at.addGrant({ roomJoin: true, room, canPublish: grants.canPublish, canSubscribe: grants.canSubscribe, canPublishData: false, canUpdateOwnMetadata: false });
    return at.toJwt();
  }

  async studentToken(sessionId: string, userId: string, name: string, ttlSeconds: number) {
    return { url: this.url, room: this.room(sessionId), token: await this.token(`student:${userId}`, name, this.room(sessionId), { canPublish: true, canSubscribe: false }, ttlSeconds) };
  }

  async adminToken(sessionId: string, adminId: string, name: string) {
    return { url: this.url, room: this.room(sessionId), token: await this.token(`admin:${adminId}:${Date.now()}`, name, this.room(sessionId), { canPublish: false, canSubscribe: true }, 2 * 3600) };
  }
}
