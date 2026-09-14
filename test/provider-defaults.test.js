const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { defaultModelsFor, knownModelsFor, mergeDiscoveredModels } = require('../dist/yisi/domain/providerDefaults');
const { modelContextWindow } = require('../dist/yisi/domain/modelContextWindow');
const { modelSupportsVision } = require('../dist/yisi/domain/modelCapabilities');

test('DeepSeek knows the current lineup and the retired ids it still accepts', () => {
  // Current models first, then the retired ids the API still accepts and serves
  // from DeepSeek-V4.1-Flash. Both kinds stay selectable; the retired ones are
  // labelled in the picker rather than hidden.
  assert.deepEqual(defaultModelsFor('deepseek'), [
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp'
  ]);
  assert.deepEqual(knownModelsFor('deepseek'), [
    { id: 'deepseek-flash', status: 'current' },
    { id: 'deepseek-v4-pro', status: 'current' },
    { id: 'deepseek-v4-flash', status: 'legacy', servedBy: 'deepseek-flash' },
    { id: 'deepseek-v4-flash-vision-exp', status: 'legacy', servedBy: 'deepseek-flash' }
  ]);
});

test('discovery is merged with the known roster instead of replacing it', () => {
  // DeepSeek's `GET /models` reports only the two current models. Replacing would
  // hide the retired ids that the API still accepts (and that DeepSeek's own
  // harness lists).
  assert.deepEqual(
    mergeDiscoveredModels('deepseek', ['deepseek-flash', 'deepseek-v4-pro']),
    ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
  );
  // Ids the endpoint reports that we do not know are appended after the roster.
  assert.deepEqual(
    mergeDiscoveredModels('deepseek', ['deepseek-flash', 'deepseek-v9-preview']),
    ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v9-preview']
  );
  // Duplicates and surrounding whitespace are dropped; known ids win their slot.
  assert.deepEqual(
    mergeDiscoveredModels('deepseek', ['  deepseek-flash  ', 'deepseek-v4-flash']),
    ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
  );
  // A kind with no known roster behaves exactly like plain discovery.
  assert.deepEqual(mergeDiscoveredModels('openaiCompatible', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeDiscoveredModels('openai', []), []);
});

test('every known DeepSeek model resolves a sane context window', () => {
  for (const id of defaultModelsFor('deepseek')) {
    const window = modelContextWindow('deepseek', id);
    assert.ok(typeof window === 'number' && window > 0, `${id} should resolve a window`);
  }
  // All four callable DeepSeek ids are million-token context. `deepseek-flash`
  // must not fall through to the 64k legacy default just because its id has no
  // `v4`.
  assert.equal(modelContextWindow('deepseek', 'deepseek-flash'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-pro'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash'), 1_000_000);
  assert.equal(modelContextWindow('deepseek', 'deepseek-v4-flash-vision-exp'), 1_000_000);
});

test('the DeepSeek vision model is recognized despite carrying no marker', () => {
  // Regression: `deepseek-flash` IS DeepSeek-V4.1-Flash, the vision-capable
  // model. The generic `vision`-marker heuristic cannot see that.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro'), false);
  // Retired aliases are still accepted and served by V4.1-Flash.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-flash-vision-exp'), true);
  // Dated variants inherit the family capability; an explicit marker still wins.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash-0813'), true);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro-0813'), false);
  assert.equal(modelSupportsVision('deepseek', 'deepseek-v4-pro-vision'), true);
  // Unknown ids stay conservative.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-next'), false);
  // An explicit provider override always wins.
  assert.equal(modelSupportsVision('deepseek', 'deepseek-flash', false), false);
});

test('the wizard merges discovery and the picker labels retired ids', () => {
  // providerSetupWizard imports vscode and cannot be required from a plain Node
  // test, so its two call sites are guarded at the source level. Assigning
  // `discovered` straight through is what hid the retired DeepSeek ids.
  const wizard = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'yisi', 'vscode', 'provider', 'providerSetupWizard.ts'),
    'utf8'
  );
  assert.match(wizard, /mergeDiscoveredModels\(draft\.kind, discovered\)/);
  assert.match(wizard, /mergeDiscoveredModels\(provider\.kind, discovered\)/);
  assert.equal(/let models = discovered;/.test(wizard), false);
  assert.equal(/replaceModels\(provider\.id, discovered\)/.test(wizard), false);

  // The legacy routing has to reach the UI, not just the state.
  const popover = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'yisi', 'ui', 'modelControlHtml.ts'),
    'utf8'
  );
  assert.match(popover, /if \(model\.legacyOf\)/);
});

test('unknown kinds suggest nothing and callers get a defensive copy', () => {
  assert.deepEqual(defaultModelsFor('llamaCpp'), []);
  assert.deepEqual(defaultModelsFor('openaiCompatible'), []);
  assert.deepEqual(knownModelsFor('llamaCpp'), []);
  const copy = knownModelsFor('deepseek');
  copy[0].status = 'legacy';
  copy.push({ id: 'injected', status: 'current' });
  assert.equal(knownModelsFor('deepseek')[0].status, 'current');
  assert.equal(defaultModelsFor('deepseek').includes('injected'), false);
});
