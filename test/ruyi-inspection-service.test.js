const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RuyiInspectionService,
  createRuyiInspectTool
} = require('../dist/yisi/application/ruyi/ruyiInspectionService');

function flatRun(overrides = {}) {
  return {
    status: 'exited',
    exitCode: 0,
    durationMs: 1,
    stdoutText: '',
    stdoutTruncated: false,
    stderrText: '',
    stderrTruncated: false,
    ...overrides
  };
}

function fakeRuyi(packages = [], profiles = [], mutateCounter = null) {
  return {
    async getVersion() { return 'ruyi 0.19.0'; },
    async listPackages() {
      if (mutateCounter) mutateCounter.listPackages += 1;
      return { code: 0, stdout: '', stderr: '', records: packages };
    },
    async listProfiles() {
      if (mutateCounter) mutateCounter.listProfiles += 1;
      return { code: 0, stdout: '', stderr: '', records: profiles };
    },
    async installPackage() { throw new Error('must never be called'); },
    async uninstallPackage() { throw new Error('must never be called'); }
  };
}

function commandsFor(probeResult) {
  const calls = [];
  return {
    calls,
    async run(input) {
      calls.push(input);
      return probeResult;
    }
  };
}

test('reports the ruyi environment when the CLI is present', async () => {
  const calls = [];
  const commands = { async run(input) { calls.push(input); return flatRun({ stdoutText: 'ruyi 0.19.0 (x86_64-linux)\n' }); } };
  const ruyi = fakeRuyi(
    [{ id: 'gcc-upstream', version: '12.2.0' }, { id: 'qemu-user-riscv-upstream' }],
    [{ name: 'gnu-plct' }, { name: 'gnu-ruyisdk' }]
  );
  const service = new RuyiInspectionService(commands, ruyi);
  const result = await service.inspect(new AbortController().signal);

  assert.equal(result.available, true);
  assert.match(result.version, /ruyi 0\.19\.0/);
  assert.equal(result.packageCount, 2);
  assert.deepEqual(result.packageNames, ['gcc-upstream', 'qemu-user-riscv-upstream']);
  assert.equal(result.profileCount, 2);
  assert.deepEqual(result.profileNames, ['gnu-plct', 'gnu-ruyisdk']);
  assert.match(result.summary, /Installed packages: 2/);
  assert.match(result.summary, /Available profiles: 2/);
  assert.deepEqual(calls[0], { executable: 'ruyi', args: ['--version'], cwd: '.', timeoutMs: 8000 });
});

test('reports unavailable when ruyi is missing without crashing', async () => {
  const service = new RuyiInspectionService(
    commandsFor(flatRun({ status: 'spawnFailed', exitCode: null, stderrText: 'spawn ruyi ENOENT' })),
    fakeRuyi([], [])
  );
  const result = await service.inspect(new AbortController().signal);
  assert.equal(result.available, false);
  assert.match(result.note, /not found or failed/i);
  assert.match(result.summary, /unavailable/);
  assert.equal(result.packageNames.length, 0);
});

test('keeps listing failures as notes instead of failing the whole inspection', async () => {
  const commands = commandsFor(flatRun({ stdoutText: 'ruyi 0.18.0' }));
  const ruyi = fakeRuyi([], []);
  ruyi.listPackages = async () => ({ code: 2, stdout: '', stderr: 'repository unreachable', records: [] });
  const service = new RuyiInspectionService(commands, ruyi);
  const result = await service.inspect(new AbortController().signal);
  assert.equal(result.available, true);
  assert.equal(result.packageCount, 0);
  assert.match(result.note, /repository unreachable/);
});

test('ruyi_check tool metadata is read-only and only probes read paths', async () => {
  const counters = { listPackages: 0, listProfiles: 0 };
  const service = new RuyiInspectionService(
    commandsFor(flatRun({ stdoutText: 'ruyi 0.19.0' })),
    fakeRuyi([{ id: 'gcc-upstream' }], [{ name: 'gnu-plct' }], counters)
  );
  const tool = createRuyiInspectTool(service);
  assert.equal(tool.id, 'ruyi_check');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  assert.deepEqual(tool.inputSchema.properties, {});

  const result = await tool.execute({}, { sessionId: 's1', workspaceUri: 'file:///workspace', signal: new AbortController().signal });
  assert.equal(result.available, true);
  assert.equal(counters.listPackages, 1);
  assert.equal(counters.listProfiles, 1);
});
