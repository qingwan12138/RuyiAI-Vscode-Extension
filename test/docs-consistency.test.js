// The documents that state the *current* state must agree with each other.
//
// This is a drift guard, not a formatting check. Three different files claim the
// project's current test count — the compatibility matrix (authoritative), the
// handover document (the first thing a new engineer reads) and the newest
// milestone evidence line in the roadmap — and before this guard existed they
// disagreed badly: the handover said 414 tests and a branch that no longer existed,
// the completed-work report said 410, and the matrix's own OS note said 419.
//
// Historical numbers are deliberately **not** constrained: `docs/12` records the
// count at each milestone and `docs/21` is a dated snapshot, so pinning them to
// today's value would destroy real evidence. What the guard requires is that the
// historical documents say they are historical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

/** `N tests / M pass` as stated by the authoritative matrix row. */
function matrixCounts() {
  const match = /full `node --test test\/\*\.test\.js` \| \*\*(\d+) tests \/ (\d+) pass/.exec(
    read('docs/18_COMPATIBILITY_MATRIX.md')
  );
  assert.ok(match, 'the compatibility matrix must state the full-suite result');
  return { tests: match[1], pass: match[2] };
}

test('the compatibility matrix states a current full-suite result', () => {
  const counts = matrixCounts();
  assert.ok(Number(counts.tests) > 600, `suspiciously low test count: ${counts.tests}`);
  assert.ok(Number(counts.pass) <= Number(counts.tests));
});

test('the handover document agrees with the compatibility matrix', () => {
  const counts = matrixCounts();
  const handover = read('docs/22_HANDOVER.md');
  const stated = /全量测试 \*\*(\d+) tests \/ (\d+) pass/.exec(handover);
  assert.ok(stated, 'the handover must state the current full-suite result');
  assert.equal(stated[1], counts.tests, 'handover and matrix disagree on the test count');
  assert.equal(stated[2], counts.pass, 'handover and matrix disagree on the pass count');
});

test('the newest roadmap evidence agrees with the matrix', () => {
  const counts = matrixCounts();
  const roadmap = read('docs/12_ROADMAP_AND_DOD.md');
  // The *last* occurrence is the newest milestone's evidence; earlier ones are
  // history and must stay as they were.
  const all = [...roadmap.matchAll(/全量 \*\*(\d+) tests \/ (\d+) pass/g)];
  assert.ok(all.length > 0, 'the roadmap must record milestone evidence');
  assert.equal(all.at(-1)[1], counts.tests, 'the newest roadmap evidence is stale');
});

test('the handover names the branch that exists and points at the ADRs', () => {
  const handover = read('docs/22_HANDOVER.md');
  // The old document claimed a feature branch with 84 unpushed commits.
  assert.match(handover, /`main`/, 'the handover must name the current branch');
  assert.equal(/fix\/vision-pdf-runtime/.test(handover), false, 'that branch is history, not the current state');
  for (const adr of ['0004', '0012']) {
    assert.match(handover, new RegExp(`ADR-${adr}`), `the handover must reference ADR-${adr}`);
  }
});

test('dated reports are marked as historical rather than left to look current', () => {
  const report = read('docs/21_COMPLETED_WORK_REPORT.md');
  assert.match(report, /历史快照/, 'a dated report must say so');
  assert.match(report, /docs\/18_COMPATIBILITY_MATRIX\.md/, 'and must point at the current source');
});

test('every ADR referenced by the handover exists', () => {
  const referenced = new Set(
    [...read('docs/22_HANDOVER.md').matchAll(/ADR-(\d{4})/g)].map(match => match[1])
  );
  assert.ok(referenced.size >= 9, `expected the handover to index the ADR set, found ${referenced.size}`);
  for (const id of referenced) {
    const file = fs.readdirSync(path.join(root, 'docs', 'decisions')).find(name => name.startsWith(`ADR-${id}`));
    assert.ok(file, `docs/decisions has no ADR-${id}`);
  }
});
