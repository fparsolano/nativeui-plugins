/** Minimal dependency-free newline-delimited JSON-RPC 2.0 stdio transport. */
export function createRpcServer({ serverInfo, listTools, callTool, toToolResult, stderr = process.stderr }) {
  async function dispatch(request) {
    const id = request?.id;
    const reply = (result) => id === undefined ? null : { jsonrpc: '2.0', id, result };
    const fail = (code, message) => id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } };
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return fail(-32600, 'Invalid Request');
    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'initialize') return reply({ protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo });
    if (request.method === 'ping') return reply({});
    if (request.method === 'tools/list') return reply({ tools: listTools() });
    if (request.method === 'tools/call') {
      const name = request.params?.name;
      try {
        const result = await callTool(name, request.params?.arguments || {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        return reply(toToolResult(error));
      }
    }
    return fail(-32601, `Method not found: ${request.method}`);
  }

  return {
    async handleLine(line) {
      let request;
      try { request = JSON.parse(line); } catch {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }
      try { return await dispatch(request); } catch (error) {
        stderr.write(`nativeui MCP internal error: ${error?.stack || error}\n`);
        return request?.id === undefined ? null : { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } };
      }
    },
  };
}

export async function serveStdio(server, input = process.stdin, output = process.stdout) {
  let buffered = '';
  input.setEncoding('utf8');
  for await (const chunk of input) {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const response = await server.handleLine(line);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  }
}
