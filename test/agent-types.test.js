const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAgentToolCall,
  parseAgentToolDefinition
} = require('../dist/yisi/llm/types');

test('parses and clones an exact agent tool definition', () => {
  const parameters = {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false
  };
  const parsed = parseAgentToolDefinition({
    name: ' read_file ',
    description: ' Read a file ',
    parameters
  });

  assert.deepEqual(parsed, {
    name: 'read_file',
    description: 'Read a file',
    parameters
  });
  assert.notEqual(parsed.parameters, parameters);
});

test('parses and clones a completed tool call with object input', () => {
  const input = { path: 'src/main.ts' };
  const parsed = parseAgentToolCall({ id: ' call-1 ', name: ' read_file ', input });

  assert.deepEqual(parsed, { id: 'call-1', name: 'read_file', input });
  assert.notEqual(parsed.input, input);
});

test('rejects blank identifiers, arrays, non-object inputs, and extra keys', () => {
  for (const value of [
    { id: '', name: 'read_file', input: {} },
    { id: '1', name: ' ', input: {} },
    { id: '1', name: 'read_file', input: [] },
    { id: '1', name: 'read_file', input: null },
    { id: '1', name: 'read_file', input: {}, extra: true }
  ]) {
    assert.throws(() => parseAgentToolCall(value), /Invalid agent tool call/);
  }

  for (const value of [
    { name: '', description: 'x', parameters: {} },
    { name: 'x', description: '', parameters: {} },
    { name: 'x', description: 'x', parameters: [] },
    { name: 'x', description: 'x', parameters: {}, extra: true }
  ]) {
    assert.throws(() => parseAgentToolDefinition(value), /Invalid agent tool definition/);
  }
});
