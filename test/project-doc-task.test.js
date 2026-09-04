const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectDocTaskMessage } = require('../dist/yisi/application/chat/projectDocTask');

function sampleContext(overrides = {}) {
  return { projectName: 'riscv-demo', fileName: '/workspace/riscv-demo', ...overrides };
}

test('readme task names the workspace scope and document goals', () => {
  const message = buildProjectDocTaskMessage('readme', sampleContext());
  assert.match(message, /\[项目任务\] 生成项目 README/);
  assert.match(message, /范围：riscv-demo（\/workspace\/riscv-demo，整个工作区，无选区）/);
  assert.match(message, /inspect_project/);
  assert.match(message, /README\.md/);
  assert.ok(!message.includes('```'), 'project tasks carry no code fence');
});

test('api docs task asks for public-symbol documentation per language', () => {
  const message = buildProjectDocTaskMessage('apiDocs', sampleContext({ projectName: 'jvm-tool' }));
  assert.match(message, /\[项目任务\] 生成 API 文档/);
  assert.match(message, /范围：jvm-tool/);
  assert.match(message, /C\/C\+\+/);
  assert.match(message, /Javadoc/);
  assert.match(message, /docs\/API\.md/);
});

test('embeds the project detection block when provided', () => {
  const summary = 'Languages: C++\nBuild: cmake (CMakeLists.txt)\nTest frameworks: ctest';
  const message = buildProjectDocTaskMessage('readme', sampleContext(), summary);
  assert.match(message, /\[项目探测结果\]/);
  assert.ok(message.indexOf(summary) >= 0, 'summary must appear verbatim');
  assert.ok(message.indexOf('[项目探测结果]') < message.indexOf('请分析'), 'profile precedes instructions');
});

test('renders without a project block when the summary is empty', () => {
  const message = buildProjectDocTaskMessage('apiDocs', sampleContext(), '   ');
  assert.ok(!message.includes('[项目探测结果]'));
  assert.match(message, /请分析当前工作区/);
});

test('rejects blank project names', () => {
  assert.throws(() => buildProjectDocTaskMessage('readme', sampleContext({ projectName: '  ' })));
});
