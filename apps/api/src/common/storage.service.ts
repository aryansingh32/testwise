import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
export const UPLOAD_DIR = join(process.cwd(), 'uploads');

/**
 * Local-disk storage for development. Swap for an S3-compatible bucket
 * (Railway Buckets / R2) in production behind the same interface.
 */
@Injectable()
export class StorageService {
  async saveImage(originalName: string, data: Buffer, folder = 'images'): Promise<string> {
    const ext = extname(originalName).toLowerCase();
    if (!ALLOWED.has(ext)) throw new BadRequestException(`Unsupported image type: ${ext || 'none'}`);
    if (data.length > 5 * 1024 * 1024) throw new BadRequestException(`${originalName} is larger than 5 MB`);
    const dir = join(UPLOAD_DIR, folder);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), data);
    return `${process.env.PUBLIC_BASE_URL ?? ''}/uploads/${folder}/${name}`;
  }
}

/** Private files (proctoring evidence). Never served statically; read through signed admin URLs. */
export const PRIVATE_DIR = join(process.cwd(), 'private-uploads');

const PRIVATE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'audio/3gpp': '.3gp',
};

function evidenceSecret() {
  return `evidence:${process.env.JWT_ADMIN_SECRET ?? 'dev'}`;
}

@Injectable()
export class PrivateStorageService {
  async save(folder: string, mime: string, data: Buffer): Promise<{ key: string; mime: string }> {
    const ext = PRIVATE_TYPES[mime.toLowerCase()];
    if (!ext) throw new BadRequestException(`Unsupported evidence type: ${mime}`);
    const max = Number(process.env.EVIDENCE_MAX_MB ?? 8) * 1024 * 1024;
    if (data.length > max) throw new BadRequestException('Evidence file too large');
    if (!/^[a-z0-9/_-]+$/i.test(folder)) throw new BadRequestException('Bad folder');
    const dir = join(PRIVATE_DIR, folder);
    await mkdir(dir, { recursive: true });
    const key = `${folder}/${randomUUID()}${ext}`;
    await writeFile(join(PRIVATE_DIR, key), data);
    return { key, mime: mime.toLowerCase() };
  }

  private path(key: string) {
    if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(key) || key.includes('..')) throw new BadRequestException('Bad key');
    return join(PRIVATE_DIR, key);
  }

  read(key: string) {
    return readFile(this.path(key));
  }

  async remove(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }

  /** Short-lived URL an admin <img>/<audio> can load without an Authorization header. */
  signedUrl(key: string, ttlSeconds = 900) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = createHmac('sha256', evidenceSecret()).update(`${key}:${exp}`).digest('hex');
    return `${process.env.PUBLIC_BASE_URL ?? ''}/v1/proctor/evidence?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  verify(key: string, exp: string, sig: string) {
    if (!key || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
    const want = createHmac('sha256', evidenceSecret()).update(`${key}:${exp}`).digest('hex');
    return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
  }

  mimeOf(key: string) {
    const ext = extname(key).toLowerCase();
    return Object.entries(PRIVATE_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
  }
}
