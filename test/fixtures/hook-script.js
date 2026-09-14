#!/usr/bin/env node
// A hook fixture for test/hooks-process.test.js.
//
// Reads the event payload as JSON on stdin and answers on stdout according to
// the mode given as argv[2]. It exists to exercise the executor's contract:
// decisions, plain-text feedback, malformed output, failures and timeouts.

'use strict';

const mode = process.argv[2] || '--allow';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});
process.stdin.on('end', () => {
  const payload = (() => {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  })();

  switch (mode) {
    case '--deny':
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'the guardrail says no' }));
      return;
    case '--allow':
      process.stdout.write(
        JSON.stringify({ decision: 'allow', context: `seen:${payload && payload.tool ? payload.tool.id : 'nothing'}` })
      );
      return;
    case '--echo':
      // Proves the payload arrived intact, including the tool input.
      process.stdout.write(JSON.stringify({ context: input.trim() }));
      return;
    case '--plain':
      process.stdout.write('lint: 2 warnings, 0 errors');
      return;
    case '--garbage':
      process.stdout.write('this is not json');
      return;
    case '--unknown':
      // Not a decision the port defines: it must never be read as permission.
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    case '--non-object':
      process.stdout.write(JSON.stringify(['allow']));
      return;
    case '--fail':
      process.stderr.write('hook exploded');
      process.exit(3);
      return;
    case '--hang':
      setTimeout(() => undefined, 60_000);
      return;
    case '--empty':
      return;
    default:
      process.exit(2);
  }
});
