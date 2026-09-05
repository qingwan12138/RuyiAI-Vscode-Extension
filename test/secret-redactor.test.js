const test = require('node:test');
const assert = require('node:assert/strict');

const { createSecretRedactor } = require('../dist/yisi/application/security/secretRedactor');

test('redacts exact secret values everywhere they appear', () => {
  const r = createSecretRedactor();
  const out = r.redact('key=sk-abc123 and again sk-abc123', ['sk-abc123']);
  assert.equal(out.includes('sk-abc123'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('censores common secret shapes (Authorization, api_key, sk-)', () => {
  const r = createSecretRedactor();
  assert.match(r.censor('Authorization: Bearer abcdef123456'), /Authorization: Bearer \[REDACTED\]/);
  assert.match(r.censor('api_key=supersecret'), /api_key=\[REDACTED\]/);
  assert.match(r.censor('token: secret-token-abc'), /token: \[REDACTED\]/);
  assert.match(r.censor('sk-1122334455667788'), /sk-\[REDACTED\]/);
});

test('likelySecret flags secret-ish strings and ignores plain text', () => {
  const r = createSecretRedactor();
  assert.equal(r.likelySecret('sk-abc123'), true);
  assert.equal(r.likelySecret('api_key=xyz'), true);
  assert.equal(r.likelySecret('hello world'), false);
  assert.equal(r.likelySecret(''), false);
});

test('redact never crashes on empty / non-string values', () => {
  const r = createSecretRedactor();
  assert.equal(r.redact('', []), '');
  assert.equal(r.redact('plain text', ['short']), 'plain text');
});
