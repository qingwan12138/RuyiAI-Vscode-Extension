const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSelectionTaskMessage,
  languageDisplayName,
  selectionFenceToken,
  MAX_SELECTION_TASK_CHARS
} = require('../dist/yisi/application/chat/editorSelectionTask');

function sampleContext(overrides = {}) {
  return {
    fileName: 'src/sort.c',
    languageId: 'c',
    lineStart: 10,
    lineEnd: 24,
    code: 'int sort(int *a) {\n  return 0;\n}',
    ...overrides
  };
}

test('explain message contains label, location and a c fenced code block', () => {
  const message = buildSelectionTaskMessage('explain', sampleContext());
  assert.match(message, /\[选区任务\] 解释这段代码/);
  assert.match(message, /位置：src\/sort\.c · C · 第 10–24 行/);
  assert.match(message, /```c\nint sort\(int \*a\) \{/);
  assert.match(message, /用中文解释选中代码/);
});

test('comment task points at documentation + inline comments, keeps original code', () => {
  const message = buildSelectionTaskMessage('comment', sampleContext({ languageId: 'cpp', fileName: 'core.cpp' }));
  assert.match(message, /\[选区任务\] 为这段代码生成注释/);
  assert.match(message, /位置：core\.cpp · C\+\+ · 第 10–24 行/);
  assert.match(message, /可直接替换选区的完整代码/);
});

test('unit test task names contract frameworks and tool-optional strategy', () => {
  const message = buildSelectionTaskMessage('unitTests', sampleContext({ languageId: 'java', fileName: 'Calc.java' }));
  assert.match(message, /\[选区任务\] 为这段代码生成单元测试/);
  assert.match(message, /CMake\/ctest、GoogleTest、Catch2/);
  assert.match(message, /JUnit/);
  assert.match(message, /可直接编译运行/);
});

test('long selections are truncated with an explicit note', () => {
  const code = 'x'.repeat(MAX_SELECTION_TASK_CHARS + 500);
  const message = buildSelectionTaskMessage('explain', sampleContext({ code }));
  assert.ok(message.length < code.length + 800, 'truncation should bound the message');
  assert.match(message, new RegExp(`已截断为前 ${MAX_SELECTION_TASK_CHARS} 字符`));
  assert.ok(!message.includes('x'.repeat(MAX_SELECTION_TASK_CHARS + 1)), 'tail must not leak into the message');
});

test('language display labels and fence tokens', () => {
  assert.equal(languageDisplayName('cpp'), 'C++');
  assert.equal(languageDisplayName('c'), 'C');
  assert.equal(languageDisplayName('java'), 'Java');
  assert.equal(languageDisplayName('typescript'), 'TypeScript');
  assert.equal(languageDisplayName(''), 'text');
  assert.equal(selectionFenceToken('cpp'), 'cpp');
  assert.equal(selectionFenceToken('C++'), '');
  assert.equal(selectionFenceToken('plaintext'), '');
});

test('invalid contexts throw instead of producing a malformed prompt', () => {
  assert.throws(() => buildSelectionTaskMessage('explain', sampleContext({ code: '  ' })));
  assert.throws(() => buildSelectionTaskMessage('explain', sampleContext({ fileName: '' })));
  assert.throws(() => buildSelectionTaskMessage('explain', sampleContext({ lineStart: 0 })));
});
