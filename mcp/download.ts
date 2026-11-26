import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { DesignState } from '../src/core/render';
import { cleanSettings } from '../src/state';

const DAY_MS = 24 * 60 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// The link carries the resolved design, encrypted so the text stays out of proxy logs.
// Any instance with the same secret can serve it without shared storage.
export function svgDownloads(secret: string, origin: URL) {
  const key = createHmac('sha256', secret).update('warp-and-shear/svg/v1').digest();

  return {
    create(design: DesignState) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify({ expires: Date.now() + DAY_MS, design }), 'utf8'),
        cipher.final(),
      ]);
      const encoded = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      return new URL(`/download/${encoded}/warp-and-shear.svg`, origin).href;
    },

    read(ticket: string): DesignState | undefined {
      const bytes = Buffer.from(ticket, 'base64url');
      if (bytes.length <= IV_BYTES + TAG_BYTES || bytes.toString('base64url') !== ticket) return;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES));
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const data = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        const { design, expires } = JSON.parse(data.toString('utf8')) as { design: unknown; expires: number };
        if (expires > Date.now()) return cleanSettings(design);
      } catch {
        return; // An expired, altered, or otherwise invalid ticket has no downloadable file.
      }
    },
  };
}
