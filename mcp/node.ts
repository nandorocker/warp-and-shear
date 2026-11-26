import { readFile } from 'node:fs/promises';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createWarpMcp, MAX_REQUEST_BYTES } from './http';

export function createNodeMcp(config: Omit<Parameters<typeof createWarpMcp>[0], 'loadFont'>) {
  const mcp = createWarpMcp({
    ...config,
    async loadFont(file) {
      return Uint8Array.from(await readFile(new URL(`../public/${file}`, import.meta.url))).buffer;
    },
  });
  return {
    handle: toNodeHandler(mcp, { maxRequestBodySize: MAX_REQUEST_BYTES, onerror: console.error }),
    close: mcp.close,
  };
}
