// Plan review: the document handed to the user, and the comments they leave in it.
//
// The properties under test:
//   - the plan is a **document**, not a one-line card summary, so a multi-step
//     change can actually be judged;
//   - what the user changes in it comes back as **feedback** — on approval and on
//     refusal alike — and never as a permission decision (the card still decides);
//   - a port that only returns a boolean keeps working unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildPlanDocument, extractPlanFeedback, normalizePlan } = require('../dist/yisi/application/agent/planReview');
const { parsePermissionEscalation } = require('../dist/yisi/application/agent/requestPermissionTool');
const { AgentToolLoop } = require('../dist/yisi/application/agent/readOnlyAgentLoop');
const { ToolRegistry } = require('../dist/yisi/application/agent/toolRegistry');
const { PermissionEngine } = require('../dist/yisi/permissions/permissionEngine');

const SIGNAL = new AbortController().signal;
const PLAN = ['1. Add `greet()` to src/greet.ts.', '2. Call it from src/index.ts.', '3. Run `npm test`.'].join('\n');

// --- the document ----------------------------------------------------------

test('a plan is normalized and bounded', () => {
  assert.equal(normalizePlan('  # Plan\r\n\r\nDo it.  '), '# Plan\n\nDo it.');
  assert.equal(normalizePlan('   '), undefined);
  assert.equal(normalizePlan(42), undefined);
  const long = normalizePlan('x'.repeat(9_000));
  assert.ok(long.length <= 8_000);
  assert.match(long, /…$/);
});

test('the document says how to review it, and carries the plan verbatim', () => {
  const document = buildPlanDocument({ plan: PLAN, mode: 'acceptEdits', justification: 'Apply the refactor.' });
  assert.match(document, /^# Plan for review/);
  // The decision is still the sidebar card's; the document only collects comments.
  assert.match(document, /Decide in the \*\*Yisi AI sidebar\*\*/);
  assert.match(document, /Comment inline/);
  assert.match(document, /Requested mode:\*\* Accept Edits/);
  assert.match(document, /Why:\*\* Apply the refactor\./);
  assert.ok(document.endsWith(PLAN), 'the plan is appended verbatim');
});

test('only what the user changed is extracted as feedback', () => {
  const original = buildPlanDocument({ plan: PLAN, mode: 'acceptEdits', justification: 'Apply it.' });
  assert.equal(extractPlanFeedback(original, original), undefined, 'no edits, no feedback');
  assert.equal(extractPlanFeedback(original, ''), undefined, 'an emptied document is not feedback');
  assert.equal(extractPlanFeedback(original, undefined), undefined);

  const edited = original.replace('2. Call it from src/index.ts.', '2. Do NOT touch src/index.ts — use src/app.ts instead.');
  const feedback = extractPlanFeedback(original, edited);
  assert.match(feedback, /^-2\. Call it from src\/index\.ts\.$/m);
  assert.match(feedback, /^\+2\. Do NOT touch src\/index\.ts/m);
  // The unchanged lines stay out of it: feedback is what changed, not the plan again.
  assert.equal(/Add `greet\(\)`/.test(feedback), false);
  assert.equal(/^---/m.test(feedback), false, 'the diff header is not fed back');
  assert.ok(feedback.length < 500);
});

test('long feedback is bounded', () => {
  const original = 'a\n';
  const edited = `${original}${Array.from({ length: 200 }, (unused, index) => `comment ${index} ${'y'.repeat(40)}`).join('\n')}`;
  const feedback = extractPlanFeedback(original, edited);
  assert.ok(feedback.length <= 2_000, `feedback was ${feedback.length}`);
});

// --- the tool contract -----------------------------------------------------

test('the escalation request carries an optional plan', () => {
  const without = parsePermissionEscalation({ mode: 'acceptEdits', justification: 'Apply it.' });
  assert.deepEqual(without, { mode: 'acceptEdits', justification: 'Apply it.' });
  assert.equal('plan' in without, false);

  const withPlan = parsePermissionEscalation({ mode: 'acceptEdits', justification: 'Apply it.', plan: PLAN });
  assert.equal(withPlan.plan, PLAN);
  // An empty plan is the same as no plan.
  assert.equal('plan' in parsePermissionEscalation({ mode: 'acceptEdits', justification: 'x', plan: '  ' }), false);
});

// --- through the loop ------------------------------------------------------

function writeTool() {
  return {
    id: 'replace_text',
    description: 'Replace',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true })
  };
}

function requestPermissionTool() {
  return {
    id: 'request_permission',
    description: 'Ask for a wider mode',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: false,
    permissionEscalation: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      throw new Error('intercepted');
    }
  };
}

/**
 * A run that is refused once (so the escalation is grounded) and then asks to
 * apply a plan.
 */
async function runEscalation({ confirm }) {
  const requests = [];
  const provider = {
    async *streamAgent(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield { type: 'toolCall', call: { id: 'c1', name: 'replace_text', input: {} } };
        return;
      }
      if (requests.length === 2) {
        yield {
          type: 'toolCall',
          call: {
            id: 'c2',
            name: 'request_permission',
            input: { mode: 'acceptEdits', justification: 'Apply the reviewed plan.', plan: PLAN }
          }
        };
        return;
      }
      yield { type: 'textDelta', text: 'done' };
    }
  };
  const seen = [];
  const loop = new AgentToolLoop(
    provider,
    new ToolRegistry([writeTool(), requestPermissionTool()]),
    new PermissionEngine(),
    {},
    {
      async confirm(request) {
        seen.push(request);
        return confirm();
      }
    }
  );
  const result = await loop.run(
    { model: 'm', messages: [{ role: 'user', content: 'go' }] },
    { sessionId: 's', workspaceUri: 'file:///w', signal: SIGNAL },
    'plan',
    () => undefined,
    SIGNAL
  );
  const toolMessages = requests
    .at(-1)
    .messages.filter(message => message.role === 'tool')
    .map(message => JSON.parse(message.content));
  return { result, request: seen[0], toolMessages };
}

test('the plan is handed to the approval as a document', async () => {
  const { request } = await runEscalation({ confirm: () => true });
  assert.ok(request.planDocument, 'the review document must reach the port');
  assert.match(request.planDocument, /# Plan for review/);
  assert.match(request.planDocument, /Run `npm test`/);
});

test('comments left in the plan reach the model after approval', async () => {
  const { request, toolMessages } = await runEscalation({
    confirm: () => ({ approved: true, feedback: '+2. Use src/app.ts instead.' })
  });
  assert.ok(request.planDocument);
  const escalationResult = toolMessages.find(message => message.mode !== undefined);
  assert.equal(escalationResult.ok, true);
  assert.equal(escalationResult.mode, 'acceptEdits');
  assert.match(escalationResult.planFeedback, /Use src\/app\.ts instead/);
});

test('comments also reach the model when the plan is declined', async () => {
  const { toolMessages } = await runEscalation({
    confirm: () => ({ approved: false, feedback: '-1. Drop the greet() helper.' })
  });
  // The first denial is the grounding refusal of `replace_text`; the escalation's
  // answer is the last one.
  const refusal = toolMessages.filter(message => message.denied === true).at(-1);
  assert.equal(refusal.reason, 'user');
  assert.match(refusal.error, /Comments they left in the plan/);
  assert.match(refusal.error, /Drop the greet\(\) helper/);
  // The refusal is still a refusal: nothing was widened.
  assert.equal(toolMessages.some(message => message.mode !== undefined), false);
});

test('approval without comments stays exactly as it was', async () => {
  const { toolMessages } = await runEscalation({ confirm: () => ({ approved: true }) });
  const escalationResult = toolMessages.find(message => message.mode !== undefined);
  assert.equal('planFeedback' in escalationResult, false);
});

test('a port that only returns a boolean still works', async () => {
  const { toolMessages } = await runEscalation({ confirm: () => true });
  const escalationResult = toolMessages.find(message => message.mode !== undefined);
  assert.equal(escalationResult.ok, true);
  assert.equal('planFeedback' in escalationResult, false);
});

test('the composition root wires the plan presenter, and the card still decides', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'yisi', 'index.ts'), 'utf8');
  assert.match(index, /new PlanDocumentPresenter\(\)/);
  assert.match(index, /planDocuments\s*\n?\s*\)/);

  const confirmation = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'yisi', 'vscode', 'agent', 'vsCodeToolConfirmation.ts'),
    'utf8'
  );
  // The document is opened before the decision is awaited, and the decision is
  // still the sidebar's alone.
  const openAt = confirmation.indexOf('this.planDocuments?.open(');
  const gateAt = confirmation.indexOf('await this.approvals.request(');
  assert.ok(openAt > 0 && gateAt > openAt);
  assert.match(confirmation, /return feedback \? \{ approved, feedback \} : approved/);
});
