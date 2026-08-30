const test = require('node:test');
const assert = require('node:assert/strict');

const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

const engine = new PermissionEngine();

function evaluate(mode, risk, mutatesWorkspace = risk === 'workspaceWrite') {
  return engine.evaluate(mode, { risk, mutatesWorkspace });
}

test('allows consistent read-only tools without confirmation in every mode', () => {
  for (const mode of ['plan', 'manual', 'acceptEdits', 'auto', 'fullAccess']) {
    assert.deepEqual(evaluate(mode, 'readOnly', false), {
      outcome: 'allow',
      allowed: true,
      needsConfirmation: false,
      reason: 'Read-only workspace action.'
    });
  }
});

test('Plan denies every state-changing or privileged risk class', () => {
  for (const risk of ['workspaceWrite', 'processExec', 'network', 'environmentChange', 'destructive', 'credentialSensitive']) {
    const decision = evaluate('plan', risk, true);
    assert.equal(decision.outcome, 'deny');
    assert.equal(decision.allowed, false);
    assert.equal(decision.needsConfirmation, false);
  }
});

test('Manual confirms writes and privileged actions while Accept Edits only auto-allows file writes', () => {
  assert.equal(evaluate('manual', 'workspaceWrite').outcome, 'confirm');
  assert.equal(evaluate('manual', 'processExec', false).outcome, 'confirm');
  assert.equal(evaluate('acceptEdits', 'workspaceWrite').outcome, 'allow');
  assert.equal(evaluate('acceptEdits', 'processExec', false).outcome, 'confirm');
  assert.equal(evaluate('acceptEdits', 'destructive', true).outcome, 'confirm');
});

test('Auto remains conservative for privileged risks and Full Access keeps hard confirmations', () => {
  assert.equal(evaluate('auto', 'workspaceWrite').outcome, 'allow');
  assert.equal(evaluate('auto', 'processExec', false).outcome, 'confirm');
  assert.equal(evaluate('auto', 'network', false).outcome, 'confirm');
  assert.equal(evaluate('fullAccess', 'processExec', false).outcome, 'allow');
  assert.equal(evaluate('fullAccess', 'network', false).outcome, 'allow');
  assert.equal(evaluate('fullAccess', 'destructive', true).outcome, 'confirm');
  assert.equal(evaluate('fullAccess', 'credentialSensitive', false).outcome, 'confirm');
});

test('denies inconsistent or unknown metadata instead of trusting the caller', () => {
  assert.equal(evaluate('fullAccess', 'readOnly', true).outcome, 'deny');
  assert.equal(engine.evaluate('fullAccess', { risk: 'invented', mutatesWorkspace: false }).outcome, 'deny');
  assert.equal(engine.evaluate('fullAccess', { risk: 'workspaceWrite', mutatesWorkspace: false }).outcome, 'deny');
});
