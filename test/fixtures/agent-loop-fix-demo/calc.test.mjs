import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, multiply } from './calc.js';

test('add', () => {
  assert.equal(add(1, 2), 3);
});

test('multiply', () => {
  assert.equal(multiply(2, 3), 6);
});
