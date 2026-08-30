const test = require('node:test');
const assert = require('node:assert/strict');

const { VsCodeDiagnosticProvider } = require('../dist/yisi/vscode/diagnostics/vsCodeDiagnosticProvider');

const uri = value => ({ toString: () => value });
const range = (line, character) => ({
  start: { line, character },
  end: { line, character: character + 2 }
});

test('returns only configured workspace diagnostics with normalized stable evidence', async () => {
  const root = uri('file:///workspace');
  const otherRoot = uri('file:///other');
  const fileB = uri('file:///workspace/b.ts');
  const fileA = uri('file:///workspace/a.ts');
  const outside = uri('file:///other/x.ts');
  const folders = new Map([[fileA, root], [fileB, root], [outside, otherRoot]]);
  const facade = {
    getDiagnostics: () => [
      [fileB, [{ range: range(4, 1), message: 'warning', severity: 1, source: 'ts' }]],
      [outside, [{ range: range(0, 0), message: 'outside', severity: 0 }]],
      [fileA, [{ range: range(2, 3), message: 'error', severity: 0, code: { value: 123 } }]]
    ],
    getWorkspaceFolder: target => {
      const folder = folders.get(target);
      return folder ? { uri: folder } : undefined;
    }
  };
  const provider = new VsCodeDiagnosticProvider(facade, ['file:///workspace'], 20);

  const snapshot = await provider.read(new AbortController().signal);

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.total, 2);
  assert.deepEqual(snapshot.counts, { error: 1, warning: 1, information: 0, hint: 0 });
  assert.deepEqual(snapshot.items.map(item => item.uri), ['file:///workspace/a.ts', 'file:///workspace/b.ts']);
  assert.equal(snapshot.items[0].code, '123');
  assert.equal(snapshot.truncated, false);
});

test('bounds retained diagnostics while preserving total counts', async () => {
  const root = uri('file:///workspace');
  const file = uri('file:///workspace/a.ts');
  const facade = {
    getDiagnostics: () => [[file, Array.from({ length: 4 }, (_, line) => ({
      range: range(line, 0), message: `problem ${line}`, severity: line % 2
    }))]],
    getWorkspaceFolder: () => ({ uri: root })
  };
  const snapshot = await new VsCodeDiagnosticProvider(facade, ['file:///workspace'], 2)
    .read(new AbortController().signal);

  assert.equal(snapshot.total, 4);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(snapshot.counts, { error: 2, warning: 2, information: 0, hint: 0 });
});

test('returns unavailable without workspace roots and honors cancellation', async () => {
  const facade = { getDiagnostics: () => { throw new Error('must not read'); }, getWorkspaceFolder: () => undefined };
  const unavailable = await new VsCodeDiagnosticProvider(facade, [], 10).read(new AbortController().signal);
  assert.deepEqual(unavailable, {
    available: false,
    items: [], total: 0, truncated: false,
    counts: { error: 0, warning: 0, information: 0, hint: 0 }
  });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new VsCodeDiagnosticProvider(facade, ['file:///workspace'], 10).read(controller.signal),
    error => error && error.name === 'AbortError'
  );
});

test('rejects an invalid diagnostic item limit', () => {
  const facade = { getDiagnostics: () => [], getWorkspaceFolder: () => undefined };
  assert.throws(() => new VsCodeDiagnosticProvider(facade, [], 0), /positive integer/);
});
