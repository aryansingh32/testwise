/** Minimal CBOR decoder (RFC 8949) covering what Apple App Attest objects use: ints, byte/text strings, arrays, maps. */
export function decodeCbor(buf: Buffer): unknown {
  let pos = 0;
  const readLen = (info: number): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (size < 0) throw new Error('unsupported CBOR length');
    if (pos + size > buf.length) throw new Error('CBOR truncated');
    const v = size === 8 ? Number(buf.readBigUInt64BE(pos)) : buf.readUIntBE(pos, size);
    pos += size;
    return v;
  };
  const item = (depth: number): unknown => {
    if (depth > 16) throw new Error('CBOR too deep');
    if (pos >= buf.length) throw new Error('CBOR truncated');
    const head = buf[pos++];
    const major = head >> 5;
    const len = readLen(head & 31);
    switch (major) {
      case 0:
        return len;
      case 1:
        return -1 - len;
      case 2:
      case 3: {
        if (pos + len > buf.length) throw new Error('CBOR truncated');
        const out = buf.subarray(pos, pos + len);
        pos += len;
        return major === 2 ? Buffer.from(out) : out.toString('utf8');
      }
      case 4:
        return Array.from({ length: len }, () => item(depth + 1));
      case 5: {
        const m: Record<string, unknown> = {};
        for (let i = 0; i < len; i++) m[String(item(depth + 1))] = item(depth + 1);
        return m;
      }
      default:
        throw new Error('unsupported CBOR type');
    }
  };
  const v = item(0);
  return v;
}
