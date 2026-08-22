#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { convert, supportedUnits } from './units.ts';

/**
 * Minimal MCP server over stdio: no SDK, just newline-delimited JSON-RPC 2.0
 * as specified by the MCP stdio transport (one JSON object per line, no
 * embedded newlines, no Content-Length framing).
 */

const SERVER_NAME = 'mcp-unitconv';
const SERVER_VERSION = '0.1.0';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const CONVERT_TOOL = {
  name: 'convert',
  description: 'Convert a numeric value between units of the same dimension (length, mass, time, temperature).',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'The value to convert.' },
      from: { type: 'string', description: `Source unit. One of: ${supportedUnits().join(', ')}.` },
      to: { type: 'string', description: `Target unit. One of: ${supportedUnits().join(', ')}.` },
    },
    required: ['value', 'from', 'to'],
  },
};

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: string | number, result: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id: string | number, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleToolsCall(id: string | number, params: Record<string, unknown> | undefined): void {
  const name = params?.name;
  const args = (params?.arguments ?? {}) as Record<string, unknown>;

  if (name !== 'convert') {
    respondError(id, -32602, `unknown tool: ${String(name)}`);
    return;
  }

  try {
    const value = args.value;
    const from = args.from;
    const to = args.to;
    if (typeof value !== 'number' || typeof from !== 'string' || typeof to !== 'string') {
      throw new Error('convert requires { value: number, from: string, to: string }');
    }
    const result = convert(value, from, to);
    respond(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    respond(id, { content: [{ type: 'text', text: message }], isError: true });
  }
}

function handleRequest(req: JsonRpcRequest): void {
  const { id, method, params } = req;

  if (id === undefined) {
    // Notification: no response expected, nothing for us to act on either.
    return;
  }

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      break;
    case 'tools/list':
      respond(id, { tools: [CONVERT_TOOL] });
      break;
    case 'tools/call':
      handleToolsCall(id, params);
      break;
    default:
      respondError(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed);
  } catch {
    process.stderr.write(`ignoring malformed JSON-RPC line: ${trimmed}\n`);
    return;
  }

  handleRequest(req);
});
