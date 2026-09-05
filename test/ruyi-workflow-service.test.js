const test = require('node:test');
const assert = require('node:assert/strict');

const { RuyiWorkflowService, createRuyiWorkflowTool } = require('../dist/yisi/application/ruyi/ruyiWorkflowService');

function port(records = {}) {
  return {
    async getVersion() { if (records.unavailable) throw new Error('not found'); return 'ruyi 0.19.0'; },
    async listPackages() { return { code: 0, stdout: '', stderr: '', records: records.packages ?? [] }; },
    async listProfiles() { return { code: 0, stdout: '', stderr: '', records: records.profiles ?? [] }; }
  };
}

const signal = () => new AbortController().signal;

test('reports available toolchain/profile and a satisfied sysroot/venv', async () => {
  const service = new RuyiWorkflowService(port({
    packages: [{ id: 'gcc-upstream' }, { id: 'qemu-user' }],
    profiles: [{ name: 'gnu-plct' }]
  }));
  const plan = await service.plan({ board: 'visionfive2', profile: 'gnu-plct' }, signal());
  assert.equal(plan.available, true);
  assert.deepEqual(plan.toolchainPackages, ['gcc-upstream', 'qemu-user']);
  assert.deepEqual(plan.profiles, ['gnu-plct']);
  assert.equal(plan.profilePresent, true);
  assert.equal(plan.sysrootDerivable, true);
  assert.equal(plan.venvDerivable, true);
  assert.equal(plan.gaps.length, 0, 'no gaps when profile + toolchain present');
});

test('flags a missing target profile and missing toolchain as gaps', async () => {
  const service = new RuyiWorkflowService(port({ packages: [], profiles: [{ name: 'gnu-plct' }] }));
  const plan = await service.plan({ board: 'visionfive2', profile: 'missing-profile' }, signal());
  assert.equal(plan.available, true);
  assert.equal(plan.profilePresent, false);
  assert.match(plan.gaps.join('\n'), /"missing-profile" is not installed/);
  assert.match(plan.gaps.join('\n'), /no Ruyi toolchain package is installed/);
  assert.match(plan.summary, /Target profile: missing-profile \(missing\)/);
  assert.match(plan.summary, /Sysroot derivable: no/);
});

test('reports unavailable when ruyi is missing without crashing', async () => {
  const service = new RuyiWorkflowService(port({ unavailable: true }));
  const plan = await service.plan({}, signal());
  assert.equal(plan.available, false);
  assert.match(plan.summary, /unavailable/);
  assert.match(plan.gaps[0], /ruyi CLI is not available/);
});

test('ruyi_workflow tool is read-only and sanitizes the target', async () => {
  const service = new RuyiWorkflowService(port({ packages: [{ id: 'gcc' }], profiles: [] }));
  const tool = createRuyiWorkflowTool(service);
  assert.equal(tool.id, 'ruyi_workflow');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);

  const plan = await tool.execute({ profile: '  gnu-plct  ', junk: 'ignored' }, { signal: signal() });
  assert.equal(plan.targetProfile, 'gnu-plct');
  assert.equal(plan.gaps.length > 0, true);
});
