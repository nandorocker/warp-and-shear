import { createHash, timingSafeEqual } from 'node:crypto';
import { createMcpHandler, hostHeaderValidationResponse, McpServer, originValidationResponse } from '@modelcontextprotocol/server';
import { sceneToSvg } from '../src/core/render';
import { describePresets, renderDesign, renderInput, RenderError, resolveDesign, type LoadFont } from './design';
import { svgDownloads } from './download';

export const MAX_REQUEST_BYTES = 16 * 1024;
const downloadPath = /^\/download\/([A-Za-z0-9_-]{1,4096})\/warp-and-shear\.svg$/;
const presets = describePresets();
const readOnly = { readOnlyHint: true, openWorldHint: false };

function result(data: Record<string, unknown>) {
  return { structuredContent: data, content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function hash(value: string) {
  return createHash('sha256').update(value).digest();
}

interface McpConfig {
  publicOrigin: URL;
  downloadSecret: string;
  token?: string;
  loadFont: LoadFont;
}

export function mcpSecrets(downloadSecret: string | undefined, token: string | undefined) {
  const validSecret = /^[A-Za-z0-9_-]{32,}$/;
  if (!downloadSecret || !validSecret.test(downloadSecret)) {
    throw new Error('Set MCP_DOWNLOAD_SECRET to a random URL-safe value of at least 32 characters.');
  }
  if (token !== undefined && !validSecret.test(token)) {
    throw new Error('MCP_TOKEN must be URL-safe and at least 32 characters.');
  }
  return { downloadSecret, token };
}

export function createWarpMcp({ publicOrigin, downloadSecret, token, loadFont }: McpConfig) {
  const keyHash = token ? hash(token) : undefined;
  const allowedHosts = ['localhost', '127.0.0.1', '[::1]', publicOrigin.hostname];
  const downloads = svgDownloads(downloadSecret, publicOrigin);

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'warp-and-shear', version: '1.0.0' });
    server.registerTool('list_presets', {
      title: 'List Warp & Shear presets',
      description: 'List the built-in lettering styles and their fonts, colors, and effects.',
      annotations: readOnly,
    }, () => result({ presets }));
    server.registerTool('render', {
      title: 'Render warped lettering',
      description: 'Create warped lettering and return an SVG download URL valid for 24 hours. Share that URL with the user. Returns the resolved design settings for revisions.',
      inputSchema: renderInput,
      annotations: readOnly,
    }, async (input) => {
      const design = resolveDesign(input);
      try {
        const { width, height } = await renderDesign(design, loadFont);
        return result({ downloadUrl: downloads.create(design), width, height, design });
      } catch (error) {
        if (!(error instanceof RenderError)) console.error(error);
        const text = error instanceof RenderError ? error.message : 'The renderer could not create an SVG.';
        return { isError: true, content: [{ type: 'text', text }] };
      }
    });
    return server;
  }, { maxRequestBodySize: MAX_REQUEST_BYTES, onerror: console.error });

  return {
    async fetch(request: Request) {
      const rejected = hostHeaderValidationResponse(request, allowedHosts) ?? originValidationResponse(request, allowedHosts);
      if (rejected) return rejected;
      const { pathname } = new URL(request.url);

      if (pathname === '/health' && request.method === 'GET') return new Response('ok');

      if (pathname === '/mcp') {
        const key = request.headers.get('x-api-key');
        if (keyHash && (!key || !timingSafeEqual(hash(key), keyHash))) {
          return new Response('Invalid or missing X-API-Key', { status: 401 });
        }
        return handler.fetch(request);
      }

      const ticket = downloadPath.exec(pathname)?.[1];
      if (ticket && request.method === 'GET') {
        const design = downloads.read(ticket);
        if (design) {
          const { scene } = await renderDesign(design, loadFont);
          const svg = sceneToSvg(scene, design, { background: !design.output.transparent });
          return new Response(svg, { headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Content-Disposition': 'attachment; filename="warp-and-shear.svg"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          } });
        }
      }

      return new Response('Not found', { status: 404 });
    },
    close: () => handler.close(),
  };
}
