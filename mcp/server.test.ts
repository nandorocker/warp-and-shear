import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createNodeMcp } from './node';

const downloadSecret = 'integration-tests-only-download-key';
const token = 'integration-tests-only-connector-key';

async function startServer(t: TestContext, apiKey?: string) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const publicOrigin = new URL(`http://127.0.0.1:${address.port}`);
  const mcp = createNodeMcp({ publicOrigin, downloadSecret, token: apiKey });
  server.on('request', mcp.handle);
  t.after(async () => {
    await mcp.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return publicOrigin;
}

test('lists styles and renders a downloadable SVG over MCP', async (t) => {
  const origin = await startServer(t, token);
  const endpoint = new URL('/mcp', origin);
  assert.equal((await fetch(endpoint)).status, 401);

  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { 'X-API-Key': token } },
  }));
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), ['list_presets', 'render']);
  const presets = await client.callTool({ name: 'list_presets' });
  assert.match(String(presets.content[0]?.type === 'text' && presets.content[0].text), /Swoosh/);

  const rendered = await client.callTool({ name: 'render', arguments: {
    text: 'Make it\n*move*',
    preset: 'Swoosh',
    settings: {
      color: { highlight: '#1122aa' },
      effects: { shear: { skewX: 15 } },
      output: { aspect: '4:5', transparent: true },
    },
  } });
  assert.ok(!rendered.isError, JSON.stringify(rendered));
  const block = rendered.content[0];
  assert.ok(block?.type === 'text');
  const { downloadUrl, width, height, design } = JSON.parse(block.text);
  assert.equal(design.effects.shear.skewX, 15);
  assert.equal(design.effects.envelope.enabled, true);
  assert.equal(design.text, 'Make it\n*move*');
  assert.ok(Math.abs(width / height - 0.8) < 0.01);

  const file = await fetch(downloadUrl);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') ?? '', /attachment; filename="warp-and-shear.svg"/);
  const svg = await file.text();
  assert.match(svg, /<path fill="#1122aa"/);
  assert.doesNotMatch(svg, /<rect /);

  const replica = await startServer(t);
  const path = new URL(downloadUrl).pathname;
  assert.equal(await (await fetch(new URL(path, replica))).text(), svg);
  const tampered = path.replace(/\/download\/([A-Za-z0-9_-])/, (_, first) => `/download/${first === 'a' ? 'b' : 'a'}`);
  assert.equal((await fetch(new URL(tampered, replica))).status, 404);
});

test('rejects invalid designs with the 2025-11-25 protocol', async (t) => {
  const origin = await startServer(t);
  const endpoint = new URL('/mcp', origin);
  const post = (method: string, params: unknown) => fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const initialized = await post('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' },
  });
  const readResult = async (response: Response) => {
    if (!response.headers.get('content-type')?.startsWith('text/event-stream')) return response.json();
    const event = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
    assert.ok(event);
    return JSON.parse(event.slice('data: '.length));
  };
  assert.equal(initialized.status, 200);
  assert.equal((await readResult(initialized)).result.protocolVersion, '2025-11-25');

  const call = (args: Record<string, unknown>) => post('tools/call', { name: 'render', arguments: args });
  const invalid = await call({ text: 'Test', settings: { color: { text: 'url(https://example.com)' } } });
  const invalidBody = await readResult(invalid);
  assert.ok(invalidBody.error || invalidBody.result?.isError);
  assert.match(JSON.stringify(invalidBody), /six-digit hex color/);

  const tooLarge = await call({ text: '^^^^^^^Test' });
  const tooLargeBody = await readResult(tooLarge);
  assert.equal(tooLargeBody.result.isError, true);
  assert.match(tooLargeBody.result.content[0].text, /Reduce the number/);

  const rendered = await readResult(await call({ text: 'Hello Cowork', preset: 'Waving flag' }));
  assert.ok(!rendered.result.isError);
  const { downloadUrl } = JSON.parse(rendered.result.content[0].text);
  assert.equal((await fetch(downloadUrl)).status, 200);
});
