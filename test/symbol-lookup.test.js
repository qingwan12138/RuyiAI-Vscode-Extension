const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { flattenSymbols } = require('../dist/yisi/application/context/symbolIndex');
const {
  SymbolLookupService,
  SymbolInputError,
  createListSymbolsTool,
  resolveInsideWorkspace
} = require('../dist/yisi/application/context/symbolLookupService');

const ROOT = path.resolve('C:/fake/workspace');

test('flattens a symbol tree depth-first into bounded items with a real total', () => {
  const nodes = [
    { name: 'Parser', kindLabel: 'class', lineStart: 1, children: [
      { name: 'parse', kindLabel: 'method', lineStart: 3, lineEnd: 12 },
      { name: 'tokenize', kindLabel: 'method', lineStart: 14 }
    ] },
    { name: 'main', kindLabel: 'function', lineStart: 20 }
  ];
  const index = flattenSymbols(nodes, 2);
  assert.equal(index.total, 4);
  assert.equal(index.items.length, 2);
  assert.equal(index.truncated, true);
  assert.deepEqual(index.items[0], { name: 'Parser', kindLabel: 'class', lineStart: 1 });
  assert.equal(index.items[1].name, 'parse');

  const all = flattenSymbols(nodes);
  assert.equal(all.truncated, false);
  assert.equal(all.items.length, 4);
});

test('resolves workspace-relative paths and rejects traversal', () => {
  const inside = resolveInsideWorkspace(ROOT, 'src/main.c');
  assert.equal(inside, path.join(ROOT, 'src', 'main.c'));
  assert.equal(resolveInsideWorkspace(ROOT, '.'), ROOT);
  assert.throws(() => resolveInsideWorkspace(ROOT, '../escape.c'), SymbolInputError);
});

test('returns symbol index and honest note when the provider reports none', async () => {
  const calls = [];
  const service = new SymbolLookupService(ROOT, {
    async getSymbols(absolutePath) {
      calls.push(absolutePath);
      return [{ name: 'add', kindLabel: 'function', lineStart: 5, lineEnd: 9 }];
    }
  });
  const result = await service.listSymbols({ path: 'src/calc.ts' }, new AbortController().signal);
  assert.equal(calls.length, 1);
  assert.equal(result.path, 'src/calc.ts');
  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, 'add');
  assert.equal(result.truncated, false);
  assert.equal(result.note, undefined);

  const empty = new SymbolLookupService(ROOT, { async getSymbols() { return []; } });
  const emptyResult = await empty.listSymbols({ path: 'README.md' });
  assert.match(emptyResult.note, /No symbols reported/);
});

test('list_symbols tool is read-only with a workspace-relative path schema', async () => {
  const service = new SymbolLookupService(ROOT, { async getSymbols() { return []; } });
  const tool = createListSymbolsTool(service);
  assert.equal(tool.id, 'list_symbols');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);
  assert.deepEqual(tool.inputSchema.required, ['path']);

  for (const invalid of [
    {}, { path: '' }, { path: '/abs/file.ts' }, { path: '../x.ts' }, { path: 'a', extra: true }
  ]) {
    await assert.rejects(() => service.listSymbols(invalid), SymbolInputError, JSON.stringify(invalid));
  }
});
