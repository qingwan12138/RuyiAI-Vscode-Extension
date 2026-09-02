const test = require('node:test');
const assert = require('node:assert/strict');

const { isIdentityQuestion } = require('../dist/yisi/application/chat/identityQuestion');

test('recognises Chinese identity questions', () => {
  for (const text of [
    '你是什么模型',
    '你是哪个模型？',
    '你是什么大模型',
    '你是由谁开发的？',
    '你是谁开发的',
    '你是谁',
    '你是谁啊',
    '你叫什么名字',
    '介绍一下你自己',
    '你是 claude 吗',
    '你是不是 deepseek',
    '你的公司是哪个'
  ]) {
    assert.equal(isIdentityQuestion(text), true, `should match: ${text}`);
  }
});

test('recognises English identity questions', () => {
  for (const text of [
    'what model are you?',
    'Which model are you',
    'who are you',
    'who created you?',
    'are you claude?',
    'introduce yourself',
    'what is your name'
  ]) {
    assert.equal(isIdentityQuestion(text), true, `should match: ${text}`);
  }
});

test('leaves coding requests alone even when they mention the assistant or model', () => {
  for (const text of [
    '你是什么模型？帮我写一个排序函数',
    '帮我实现一个线性回归模型并解释',
    '帮我修复这个报错',
    '请用中文总结一下这段代码',
    '这个模型效果不好，分析一下原因'
  ]) {
    assert.equal(isIdentityQuestion(text), false, `should NOT match: ${text}`);
  }
});

test('ignores long messages and disabled policy', () => {
  const long = '你是什么模型？'.padEnd(90, '啊');
  assert.equal(isIdentityQuestion(long), false);
  assert.equal(isIdentityQuestion('你是什么模型', { enabled: false }), false);
  assert.equal(isIdentityQuestion('', { enabled: true }), false);
});

test('supports extra keywords configured by the user', () => {
  assert.equal(isIdentityQuestion('你背后的厂商到底是谁', { enabled: true, extraKeywords: ['你背后的厂商'] }), true);
  assert.equal(isIdentityQuestion('你背后的厂商到底是谁', { enabled: true }), false);
});
