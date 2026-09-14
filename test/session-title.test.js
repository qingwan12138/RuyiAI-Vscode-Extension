const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SESSION_TITLE_MAX_CHARS,
  buildSessionTitleMessages,
  parseSessionTitle,
  shouldGenerateSessionTitle
} = require('../dist/yisi/application/chat/sessionTitle');

function user(text) {
  return { type: 'userMessage', id: 'u', text, createdAt: 1 };
}
function assistant(text, source = 'provider') {
  return { type: 'assistantMessage', id: 'a', text, source, createdAt: 2 };
}

test('a session is titled once, from its first completed exchange', () => {
  // Placeholder title but no model reply yet: nothing to name it from.
  assert.equal(shouldGenerateSessionTitle({ titleSource: 'fallback', items: [user('hi')] }), false);
  // Placeholder title and the first reply has landed.
  assert.equal(
    shouldGenerateSessionTitle({ titleSource: 'fallback', items: [user('hi'), assistant('hello')] }),
    true
  );
  // Already named by the model, or owned by the user: never again.
  assert.equal(shouldGenerateSessionTitle({ titleSource: 'ai', items: [user('hi'), assistant('hello')] }), false);
  assert.equal(shouldGenerateSessionTitle({ titleSource: 'manual', items: [user('hi'), assistant('hello')] }), false);
  // A baseline/error bubble is not a model reply, so a failed run does not name
  // the session from a lone user message.
  assert.equal(
    shouldGenerateSessionTitle({ titleSource: 'fallback', items: [user('hi'), assistant('boom', 'baseline')] }),
    false
  );
});

test('the title request is bare: a system instruction plus the first exchange', () => {
  const messages = buildSessionTitleMessages([
    user('帮我实现一个快速排序'),
    assistant('好的，这是实现……'),
    user('再改成降序'),
    assistant('已改为降序')
  ]);

  assert.equal(messages.length, 2, 'system + one user turn: no tools and no replayed history');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /title/i);
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /帮我实现一个快速排序/);
  assert.match(messages[1].content, /好的，这是实现/);
  assert.equal(messages[1].content.includes('再改成降序'), false, 'only the first exchange is used');
});

test('a very long first exchange is excerpted so the request stays small', () => {
  const messages = buildSessionTitleMessages([user('x'.repeat(5000)), assistant('y'.repeat(5000))]);
  assert.ok(messages[1].content.length < 3000, `excerpt not applied: ${messages[1].content.length} chars`);
});

test('the title reply is cleaned up into something a sidebar can show', () => {
  assert.equal(parseSessionTitle('修复快速排序的编译错误'), '修复快速排序的编译错误');
  assert.equal(parseSessionTitle('  "Fix the quicksort build error"  '), 'Fix the quicksort build error');
  assert.equal(parseSessionTitle('Title: Fix the build'), 'Fix the build');
  assert.equal(parseSessionTitle('标题：修复构建错误'), '修复构建错误');
  assert.equal(parseSessionTitle('# Fix the build'), 'Fix the build');
  assert.equal(parseSessionTitle('`Fix the build`'), 'Fix the build');
  assert.equal(parseSessionTitle('```\nFix the build\n```'), 'Fix the build');
  assert.equal(parseSessionTitle('Fix the build.\nThe user then asked for more.'), 'Fix the build');
});

test('an unusable reply leaves the placeholder title in place', () => {
  assert.equal(parseSessionTitle(''), undefined);
  assert.equal(parseSessionTitle('   \n  \n '), undefined);
  assert.equal(parseSessionTitle('"'), undefined);
  assert.equal(parseSessionTitle('```'), undefined);
  assert.equal(parseSessionTitle(undefined), undefined);
});

test('an over-long title is truncated to what the sidebar can show', () => {
  const title = parseSessionTitle('A'.repeat(200));
  assert.equal(title.length, SESSION_TITLE_MAX_CHARS);
  assert.equal(parseSessionTitle(`${'A'.repeat(200)}.`).length, SESSION_TITLE_MAX_CHARS);
});
