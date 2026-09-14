#!/usr/bin/env node
// A minimal MCP-shaped stdio server used only by
// test/mcp-stdio-transport.test.js. It implements the three methods the client
// uses (initialize, tools/list, tools/call) and nothing else — it is a protocol
// fixture, not a general MCP server.
//
// Modes:
//   node mcp-stdio-server.js          normal server
//   node mcp-stdio-server.js --die    writes to stderr and exits 1 immediately
//
// Env:
//   MCP_FIXTURE_MARKER=/path  writes its pid there while running and removes the
//                             file on exit, so the test can prove the child is
//                             gone after close() instead of leaking an orphan.

'use strict';

const fs = require('node:fs');

if (process.argv.includes('--die')) {
  process.stderr.write('boom: the fixture cannot start\n', () => process.exit(1));
  return;
}

const marker = process.env.MCP_FIXTURE_MARKER;
if (marker) {
  fs.writeFileSync(marker, String(process.pid));
  const remove = () => {
    try {
      fs.unlinkSync(marker);
    } catch {
      // Already gone; nothing to clean up.
    }
  };
  process.on('exit', remove);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the text argument back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
  },
  {
    name: 'slow',
    description: 'Answers after a long delay, for cancellation tests.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'fail',
    description: 'Reports a tool-level failure.',
    inputSchema: { type: 'object', properties: {} }
  }
];

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        handle(JSON.parse(line));
      } catch {
        // A malformed line is the test's bug, not something to recover from.
      }
    }
    index = buffer.indexOf('\n');
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture-server', version: '9.9.9' }
        }
      });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
      return;
    case 'tools/call': {
      const name = message.params && message.params.name;
      const args = (message.params && message.params.arguments) || {};
      if (name === 'slow') {
        setTimeout(() => {
          send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'slow done' }] } });
        }, 5000);
        return;
      }
      if (name === 'fail') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { isError: true, content: [{ type: 'text', text: 'deliberate failure' }] }
        });
        return;
      }
      if (name === 'echo') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: `echo:${args.text === undefined ? '' : args.text}` }] }
        });
        return;
      }
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      return;
    }
    default:
      // Notifications (notifications/initialized) carry no answer.
      return;
  }
}
