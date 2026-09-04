const test = require('node:test');
const assert = require('node:assert/strict');

const { ProjectProfileService, createInspectProjectTool } = require('../dist/yisi/application/context/projectProfileService');

/** In-memory FileSystemPort stand-in: entry map + content map. */
function fakeFileSystem(entriesByName, contents = {}) {
  const store = new Map();
  for (const [directory, specs] of Object.entries(entriesByName)) {
    const prefix = directory === '.' ? '' : `${directory}/`;
    store.set(directory, specs.map(spec => {
      const entry = typeof spec === 'string' ? { name: spec, kind: 'file' } : spec;
      return { path: `${prefix}${entry.name}`, name: entry.name, kind: entry.kind };
    }));
  }
  const listLog = [];
  const readLog = [];
  return {
    listLog,
    readLog,
    async listDirectory(relativePath) {
      listLog.push(relativePath);
      const entries = store.get(relativePath === '.' ? '.' : relativePath);
      if (!entries) throw new Error(`ENOENT ${relativePath}`);
      return entries;
    },
    async readFile(relativePath) {
      readLog.push(relativePath);
      const path = relativePath === '.' ? '.' : relativePath;
      if (!(path in contents)) throw new Error(`ENOENT ${relativePath}`);
      const text = contents[path];
      return { path: relativePath, text, bytes: Buffer.byteLength(text), sha256: 'x'.repeat(64) };
    }
  };
}

test('inspect scans root + source dirs and returns the project profile', async () => {
  const fs = fakeFileSystem({
    '.': ['CMakeLists.txt', 'README.md', { name: 'src', kind: 'directory' }],
    'src': ['main.cpp']
  }, {
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nproject(demo CXX)\nenable_testing()\nadd_test(NAME t COMMAND demo_tests)\nfind_package(GTest)'
  });
  const service = new ProjectProfileService(fs);
  const inspection = await service.inspect();

  assert.ok(fs.listLog.includes('src'));
  assert.ok(fs.readLog.includes('CMakeLists.txt'));
  assert.match(inspection.summary, /Languages: C, C\+\+/);
  assert.match(inspection.summary, /cmake/);
  assert.match(inspection.summary, /ctest/);
  assert.match(inspection.summary, /Suggested commands/);
});

test('inspect tolerates unreadable probe directories and missing manifests', async () => {
  const fs = fakeFileSystem({
    '.': ['README.md', { name: 'tests', kind: 'directory' }],
    'tests': ['x_test.cpp']
  }, {});
  const service = new ProjectProfileService(fs);
  const inspection = await service.inspect();

  // Naming convention fallback: *_test.cpp with no manifest still notes gtest weak.
  const gtest = inspection.profile.testFrameworks.find(item => item.kind === 'gtest');
  assert.ok(gtest, 'expects the naming-convention weak gtest detection');
  assert.equal(gtest.confidence, 'weak');
  assert.equal(inspection.profile.buildSystems.length, 0);
});

test('inspect throws a clear error when the workspace root is unreadable', async () => {
  const fs = {
    async listDirectory() { throw new Error('denied'); },
    async readFile() { throw new Error('denied'); }
  };
  const service = new ProjectProfileService(fs);
  await assert.rejects(() => service.inspect(), /readable workspace/);
});

test('inspect_project tool metadata is read-only with no required input', () => {
  const service = new ProjectProfileService({ listDirectory: async () => [], readFile: async () => { throw new Error('x'); } });
  const tool = createInspectProjectTool(service);
  assert.equal(tool.id, 'inspect_project');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  assert.equal(tool.supportsCancellation, true);
  assert.deepEqual(tool.inputSchema.required, undefined);
  assert.deepEqual(tool.inputSchema.properties, {});
});
