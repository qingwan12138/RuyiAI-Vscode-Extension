// The side-by-side proposal view (vscode/agent/proposalDiff + its pure part).
//
// What matters here:
//   - the view shows the file **in context** (whole file, not just the fragment);
//   - it is a **view**, never a second approval path — the sidebar card stays the
//     only gate, so this file also guards that ordering at the source level;
//   - it never renders a change the edit tool would refuse, because a "would
//     become" that will not actually happen is a lie about what approval does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_PROPOSAL_DIFF_BYTES,
  buildProposalView
} = require('../dist/yisi/application/edit/proposalDiffContent');

function view(toolId, input, currentText) {
  const result = buildProposalView({ toolId, input }, currentText);
  assert.ok(!('skipped' in result), `expected a view, got skipped: ${result.skipped}`);
  return result.view;
}

function skipped(toolId, input, currentText) {
  const result = buildProposalView({ toolId, input }, currentText);
  assert.ok('skipped' in result, `expected a skip, got ${JSON.stringify(result)}`);
  return result.skipped;
}

const FILE = ['function greet(name) {', '  return "hello " + name;', '}', ''].join('\n');

test('a text replacement is shown in the context of the whole file', () => {
  const result = view(
    'replace_text',
    { path: 'src/greet.js', oldText: '  return "hello " + name;', newText: '  return `hello ${name}`;' },
    FILE
  );
  assert.equal(result.title, 'Yisi AI: src/greet.js (edit)');
  assert.equal(result.path, 'src/greet.js');
  assert.equal(result.leftContent, FILE);
  assert.match(result.rightContent, /return `hello \$\{name\}`;/);
  // Only the fragment changed; everything around it is intact.
  assert.match(result.rightContent, /^function greet\(name\) \{/);
});

test('a replacement that no longer matches is skipped, not faked', () => {
  // The edit tool requires exactly one match; showing a "would become" for text
  // that is missing (or ambiguous) would misrepresent what approving does.
  assert.match(
    skipped('replace_text', { path: 'a.js', oldText: 'nope', newText: 'x' }, FILE),
    /no longer matches/
  );
  const twice = `${FILE}\n${FILE}`;
  assert.match(
    skipped('replace_text', { path: 'a.js', oldText: 'function greet', newText: 'x' }, twice),
    /no longer matches/
  );
  assert.match(
    skipped('replace_text', { path: 'a.js', oldText: 'function greet', newText: 'x' }, undefined),
    /could not be read/
  );
});

test('a new file diffs against nothing', () => {
  const result = view('create_text_file', { path: 'src/new.ts', content: 'export const a = 1;\n' }, undefined);
  assert.equal(result.leftContent, '');
  assert.equal(result.rightContent, 'export const a = 1;\n');
  assert.match(result.title, /new file/);
});

test('a whole-file rewrite and a deletion both show the current content on the left', () => {
  const rewrite = view('rewrite_text_file', { path: 'a.txt', content: 'replaced' }, FILE);
  assert.equal(rewrite.leftContent, FILE);
  assert.equal(rewrite.rightContent, 'replaced');

  const deletion = view('delete_file', { path: 'a.txt' }, FILE);
  assert.equal(deletion.leftContent, FILE);
  assert.equal(deletion.rightContent, '');
  assert.match(deletion.title, /delete/);
});

test('content is carried through verbatim, including CRLF and trailing newlines', () => {
  const crlf = 'a\r\nb\r\n';
  const result = view('rewrite_text_file', { path: 'a.txt', content: crlf }, 'x\r\n');
  assert.equal(result.rightContent, crlf, 'no line-ending normalisation in a view');
});

test('actions without text are skipped rather than shown as an empty diff', () => {
  assert.match(skipped('run_command', { executable: 'npm', args: ['test'] }, undefined), /no text diff/);
  assert.match(skipped('rename_file', { fromPath: 'a', toPath: 'b' }, undefined), /no text diff/);
  assert.match(skipped('mcp__github__create_issue', { title: 'x' }, undefined), /no text diff/);
  assert.match(skipped('create_directory', { path: 'd' }, undefined), /no text diff/);
});

test('an incomplete request is skipped instead of throwing', () => {
  assert.match(skipped('replace_text', { path: 'a.js' }, FILE), /incomplete/);
  assert.match(skipped('create_text_file', { path: 'a.js' }, undefined), /incomplete/);
  assert.match(skipped('delete_file', {}, FILE), /incomplete/);
});

test('an oversized file is skipped with the reason', () => {
  const huge = 'x'.repeat(MAX_PROPOSAL_DIFF_BYTES + 1);
  const reason = skipped('rewrite_text_file', { path: 'big.txt', content: huge }, 'small');
  assert.match(reason, /larger than \d+ KB/);
});

// --- the view is a view, not a gate ---------------------------------------

test('the approval card remains the only gate, and the diff opens first', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'yisi', 'vscode', 'agent', 'vsCodeToolConfirmation.ts'),
    'utf8'
  );
  const openAt = source.indexOf('this.proposals?.open(request)');
  const gateAt = source.indexOf('await this.approvals.request(');
  assert.ok(openAt > 0 && gateAt > openAt, 'the diff opens while the user is deciding, before the decision is awaited');
  // Fire-and-forget: a slow or failing diff must not delay or fail an approval.
  assert.match(source, /void this\.proposals\?\.open\(request\)/);
  // The presenter has no way to resolve an approval: it only renders content.
  const presenter = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'vscode', 'agent', 'proposalDiff.ts'), 'utf8');
  assert.equal(/approvals|ApprovalBroker|confirm\(/.test(presenter), false, 'the diff must not be able to approve anything');
  assert.match(presenter, /vscode\.command.*executeCommand\('vscode\.diff'/s);
});

test('the composition root registers the provider once and disposes it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(source, /new ProposalDiffPresenter\(\)/);
  assert.match(source, /dispose: \(\) => proposalDiff\.dispose\(\)/);
  // Registered once for the extension, but each runner resolves files in its own
  // execution root, so a worktree session diffs its own checkout.
  assert.match(source, /proposals \? \{ open: request => proposals\.open\(request, root\) \} : undefined/);
  assert.equal((source.match(/new ProposalDiffPresenter\(\)/g) ?? []).length, 1);
});
