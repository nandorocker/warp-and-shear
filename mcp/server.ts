import { createServer } from 'node:http';
import { mcpSecrets } from './http';
import { createNodeMcp } from './node';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.MCP_BIND_HOST ?? '127.0.0.1';
const origin = new URL(process.env.MCP_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== `${origin.origin}/`) {
  throw new Error('MCP_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
}

const secrets = mcpSecrets(process.env.MCP_DOWNLOAD_SECRET, process.env.MCP_TOKEN);
const mcp = createNodeMcp({ publicOrigin: origin, ...secrets });
const server = createServer({ headersTimeout: 15_000, requestTimeout: 30_000 }, (request, response) => {
  mcp.handle(request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500).end('The server could not complete this request.');
    else response.destroy();
  });
});

server.listen(port, host, () => console.log(`Warp & Shear MCP listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void mcp.close();
  });
}
