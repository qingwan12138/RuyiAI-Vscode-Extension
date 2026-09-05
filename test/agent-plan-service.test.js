const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentPlanService, createPlanTodoTool } = require('../dist/yisi/application/agent/agentPlanService');

const ctx = sessionId => ({ sessionId, workspaceUri: 'file:///w', signal: new AbortController().signal });

test('plan_todo adds, lists, updates and clears a session-scoped plan', async () => {
  const service = new AgentPlanService();
  const tool = createPlanTodoTool(service);
  assert.equal(tool.id, 'plan_todo');
  assert.equal(tool.risk, 'readOnly');
  assert.equal(tool.mutatesWorkspace, false);

  const added = await tool.execute({ action: 'add', text: 'fix the multiply bug' }, ctx('s1'));
  assert.equal(added.added.text, 'fix the multiply bug');
  assert.equal(added.added.status, 'pending');

  const list = await tool.execute({ action: 'list' }, ctx('s1'));
  assert.equal(list.todos.length, 1);
  assert.equal(list.todos[0].id, added.added.id);

  const updated = await tool.execute({ action: 'update', id: added.added.id, status: 'done' }, ctx('s1'));
  assert.equal(updated.updated, true);
  assert.equal((await tool.execute({ action: 'list' }, ctx('s1'))).todos[0].status, 'done');

  // Sessions are isolated from each other.
  assert.equal((await tool.execute({ action: 'list' }, ctx('s2'))).todos.length, 0);

  await tool.execute({ action: 'clear' }, ctx('s1'));
  assert.equal((await tool.execute({ action: 'list' }, ctx('s1'))).todos.length, 0);
});

test('plan_todo validates required fields', async () => {
  const tool = createPlanTodoTool(new AgentPlanService());
  await assert.rejects(() => tool.execute({ action: 'add' }, ctx('s1')), /text/);
  await assert.rejects(() => tool.execute({ action: 'update', id: 'x' }, ctx('s1')), /status/);
  await assert.rejects(() => tool.execute({ action: 'update', id: 'x', status: 'bogus' }, ctx('s1')), /status/);
});
