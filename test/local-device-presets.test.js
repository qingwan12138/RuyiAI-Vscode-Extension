const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCAL_DEVICE_PRESETS,
  localDevicePresetById
} = require('../dist/yisi/vscode/provider/localDevicePresets');

test('ships one generic and both Ruyi device presets for llama.cpp', () => {
  assert.equal(LOCAL_DEVICE_PRESETS.length, 3);
  for (const preset of LOCAL_DEVICE_PRESETS) {
    assert.equal(preset.providerKind, 'llamaCpp');
    assert.equal(preset.baseUrl, 'http://127.0.0.1:8080/v1');
    assert.ok(preset.suggestedModels.length > 0, `${preset.id} must suggest a model id`);
    assert.equal(preset.capabilities.toolCalling, true, 'llama.cpp server /v1 supports tool calling');
  }
  assert.ok(LOCAL_DEVICE_PRESETS.some(preset => preset.id === 'ruyi-nandbook'));
  assert.ok(LOCAL_DEVICE_PRESETS.some(preset => preset.id === 'ruyi-aipc'));
  assert.ok(LOCAL_DEVICE_PRESETS.some(preset => preset.id === 'linux-llamacpp'));
});

test('resolves presets by id and rejects unknown ids', () => {
  assert.equal(localDevicePresetById('ruyi-aipc')?.label, '如意 AIPC');
  assert.equal(localDevicePresetById('missing'), undefined);
});
