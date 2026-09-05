const test = require('node:test');
const assert = require('node:assert/strict');

const { RuyiManageService, createRuyiManageTool } = require('../dist/yisi/application/ruyi/ruyiManageService');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

function port() {
  const calls = [];
  return {
    calls,
    async installPackage(id, version) { calls.push(['install', id, version]); return { code: 0, stdout: '', stderr: '', records: [{ id }] }; },
    async uninstallPackage(id) { calls.push(['uninstall', id]); return { code: 0, stdout: '', stderr: '', records: [] }; },
    async createVenv(name, pkg) { calls.push(['venv_create', name, pkg]); return { code: 0, stdout: '', stderr: '', records: [{ name }] }; },
    async removeVenv(name) { calls.push(['venv_remove', name]); return { code: 0, stdout: '', stderr: '', records: [] }; },
    async createProfile(name, pkg) { calls.push(['profile_create', name, pkg]); return { code: 0, stdout: '', stderr: '', records: [{ name }] }; },
    async removeProfile(name) { calls.push(['profile_remove', name]); return { code: 0, stdout: '', stderr: '', records: [] }; },
    async update() { calls.push(['update']); return { code: 0, stdout: '', stderr: '', records: [] }; },
    async extract(pkg) { calls.push(['extract', pkg]); return { code: 0, stdout: '', stderr: '', records: [{ id: pkg }] }; }
  };
}

const signal = () => new AbortController().signal;

test('ruyi_manage tool is environmentChange, permission-gated, and dispatches typed actions', async () => {
  const p = port();
  const tool = createRuyiManageTool(new RuyiManageService(p));
  assert.equal(tool.id, 'ruyi_manage');
  assert.equal(tool.risk, 'environmentChange');
  assert.equal(tool.mutatesWorkspace, true);

  const result = await tool.execute({ action: 'install', packageId: 'gcc-upstream', version: 'v1' }, { signal: signal() });
  assert.equal(result.code, 0);
  assert.deepEqual(p.calls, [['install', 'gcc-upstream', 'v1']]);

  await tool.execute({ action: 'venv_create', name: 'rv', packageId: 'gcc-upstream' }, { signal: signal() });
  await tool.execute({ action: 'extract', packageId: 'qemu-user' }, { signal: signal() });
  assert.deepEqual(p.calls[1], ['venv_create', 'rv', 'gcc-upstream']);
  assert.deepEqual(p.calls[2], ['extract', 'qemu-user']);
});

test('ruyi_manage rejects an action that is missing its required field', async () => {
  const tool = createRuyiManageTool(new RuyiManageService(port()));
  await assert.rejects(() => tool.execute({ action: 'install' }, { signal: signal() }), /packageId/);
  await assert.rejects(() => tool.execute({ action: 'extract' }, { signal: signal() }), /packageId/);
  await assert.rejects(() => tool.execute({ action: 'venv_remove' }, { signal: signal() }), /name/);
  await assert.rejects(() => tool.execute({ action: 'bogus' }, { signal: signal() }), /unknown action/);
});

test('environmentChange risk gates correctly across permission modes', () => {
  const engine = new PermissionEngine();
  const request = { risk: 'environmentChange', mutatesWorkspace: true };
  assert.equal(engine.evaluate('plan', request).outcome, 'deny');
  assert.equal(engine.evaluate('manual', request).outcome, 'confirm');
  assert.equal(engine.evaluate('auto', request).outcome, 'confirm');
  assert.equal(engine.evaluate('acceptEdits', request).outcome, 'confirm');
  assert.equal(engine.evaluate('fullAccess', request).outcome, 'allow');
});
