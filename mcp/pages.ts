import { createWarpMcp, mcpSecrets } from './http';

interface PagesMcpContext {
  request: Request;
  env: {
    ASSETS: { fetch(request: Request): Promise<Response> };
    MCP_DOWNLOAD_SECRET?: string;
    MCP_TOKEN?: string;
  };
}

export async function onRequest({ request, env }: PagesMcpContext): Promise<Response> {
  const publicOrigin = new URL('/', request.url);
  try {
    const mcp = createWarpMcp({
      ...mcpSecrets(env.MCP_DOWNLOAD_SECRET, env.MCP_TOKEN),
      publicOrigin,
      async loadFont(file) {
        const response = await env.ASSETS.fetch(new Request(new URL(`/${file}`, publicOrigin)));
        if (!response.ok) throw new Error(`Font ${file}: HTTP ${response.status}`);
        return response.arrayBuffer();
      },
    });
    return await mcp.fetch(request);
  } catch (error) {
    console.error(error);
    return new Response('The server could not complete this request.', { status: 500 });
  }
}
