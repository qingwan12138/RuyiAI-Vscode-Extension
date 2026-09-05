const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCapabilitiesReport, createModelCapabilitiesTool } = require('../dist/yisi/application/context/modelCapabilitiesService');

test('builds a capability report with a clear degraded list when capabilities are missing', () => {
  const report = buildCapabilitiesReport('gpt-x', {
    toolCalling: false, vision: false, reasoning: true, streaming: true, maxContextTokens: 8000
  });
  assert.equal(report.available, true);
  assert.equal(report.toolCalling, false);
  assert.equal(report.vision, false);
  assert.equal(report.reasoning, true);
  assert.equal(report.maxContextTokens, 8000);
  assert.deepEqual(report.degraded, ['tool calling', 'vision / image input']);
});

test('no degraded entries when the model supports everything used', () => {
  const report = buildCapabilitiesReport('deepseek-v4-flash', {
    toolCalling: true, vision: true, reasoning: true, streaming: true
  });
  assert.deepEqual(report.degraded, []);
  assert.equal(report.available, true);
});

test('model_capabilities tool is read-only and falls back when no model', async () => {
  const tool = createModelCapabilitiesTool(async () => ({
    modelId: 'm', available: true, toolCalling: true, vision: false, reasoning: false, streaming: true, degraded: ['vision / image input']
  }));
  assert.equal(tool.id, 'model_capabilities');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  const report = await tool.execute({}, { signal: new AbortController().signal });
  assert.equal(report.available, true);
  assert.deepEqual(report.degraded, ['vision / image input']);

  const none = await createModelCapabilitiesTool(async () => null).execute({}, { signal: new AbortController().signal });
  assert.equal(none.available, false);
  assert.match(none.degraded[0], /No model/);
});
