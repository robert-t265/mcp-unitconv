import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(new URL('../src/server.ts', import.meta.url));

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Drives the server as a real subprocess over stdin/stdout, since that's the
 * only interface it exposes (no exported handler to call directly).
 */
class ServerHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string | number, (res: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor() {
    this.child = spawn(process.execPath, [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume(); // drain so a full pipe can't block the child

    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as JsonRpcResponse;
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg);
      }
    });
  }

  private sendRaw(line: string): void {
    this.child.stdin.write(`${line}\n`);
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
    const response = new Promise<JsonRpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.sendRaw(JSON.stringify(payload));
    return response;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }));
  }

  sendMalformed(line: string): void {
    this.sendRaw(line);
  }

  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve) => {
      this.child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  }

  close(): void {
    this.child.kill();
  }
}

test('initialize reports server info and tool capability', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('initialize');
    const info = res.result?.serverInfo as { name: string; version: string } | undefined;
    assert.equal(info?.name, 'mcp-unitconv');
    assert.deepEqual(res.result?.capabilities, { tools: {} });
  } finally {
    server.close();
  }
});

test('tools/list exposes the convert tool', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('tools/list');
    const tools = res.result?.tools as Array<{ name: string }> | undefined;
    assert.equal(tools?.length, 1);
    assert.equal(tools?.[0]?.name, 'convert');
  } finally {
    server.close();
  }
});

test('tools/call convert returns the conversion result as tool content', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('tools/call', {
      name: 'convert',
      arguments: { value: 1, from: 'km', to: 'm' },
    });
    const content = res.result?.content as Array<{ type: string; text: string }> | undefined;
    assert.equal(res.result?.isError, undefined);
    assert.equal(JSON.parse(content?.[0]?.text ?? '{}').value, 1000);
  } finally {
    server.close();
  }
});

test('tools/call convert reports conversion errors as isError content, not a JSON-RPC error', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('tools/call', {
      name: 'convert',
      arguments: { value: 1, from: 'km', to: 'kg' },
    });
    assert.equal(res.error, undefined);
    assert.equal(res.result?.isError, true);
  } finally {
    server.close();
  }
});

test('tools/call rejects an unknown tool name with a JSON-RPC error', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('tools/call', { name: 'bogus', arguments: {} });
    assert.equal(res.error?.code, -32602);
  } finally {
    server.close();
  }
});

test('an unknown method returns method-not-found', async () => {
  const server = new ServerHarness();
  try {
    const res = await server.request('nope');
    assert.equal(res.error?.code, -32601);
  } finally {
    server.close();
  }
});

test('a malformed JSON line is ignored and the connection keeps working', async () => {
  const server = new ServerHarness();
  try {
    server.sendMalformed('{not json');
    const res = await server.request('tools/list');
    assert.ok(res.result);
  } finally {
    server.close();
  }
});

test('notifications (no id) get no response but do not block later requests', async () => {
  const server = new ServerHarness();
  try {
    server.notify('tools/list');
    const res = await server.request('initialize');
    assert.ok(res.result);
  } finally {
    server.close();
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signal} shuts the server down cleanly`, async () => {
    const server = new ServerHarness();
    try {
      await server.request('initialize');
      const exit = server.waitForExit();
      server.kill(signal);
      const { code, signal: killedBy } = await exit;
      assert.equal(code, 0);
      assert.equal(killedBy, null);
    } finally {
      server.close();
    }
  });
}
