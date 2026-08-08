#!/usr/bin/env node
import { createRpcServer, serveStdio } from './rpc.mjs';
import { createTools, toToolResult } from './tools.mjs';

export const SERVER_INFO = Object.freeze({ name: 'nativeui', version: '0.3.0' });

export function createServer() {
  const { listTools, callTool } = createTools();
  return createRpcServer({ serverInfo: SERVER_INFO, listTools, callTool, toToolResult });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  serveStdio(createServer()).catch((error) => {
    process.stderr.write(`NativeUI MCP server failed: ${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
