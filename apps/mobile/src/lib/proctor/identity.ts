import { storage } from '../storage';

const INSTALL_KEY = 'tw_install_id';
let cached: string | null = null;

function randomId() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Random per-install id (not a hardware identifier). Lets the server notice one account on two phones and honour device bans. */
export async function installId() {
  if (cached) return cached;
  let id = await storage.get(INSTALL_KEY);
  if (!id) {
    id = randomId();
    await storage.set(INSTALL_KEY, id);
  }
  cached = id;
  return id;
}
