import { randomUUID } from 'node:crypto';
import { YisiTool } from '../../domain/tool';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

/**
 * Mature-agent plan/todo (v0.7). The model keeps a small, session-scoped task
 * list for the work it is doing (add / mark in-progress / done / list / clear).
 * In-memory only: it never touches the workspace or environment, so it is
 * read-only from the permission engine's point of view and needs no approval.
 */
export class AgentPlanService {
  private readonly plans = new Map<string, TodoItem[]>();

  list(sessionId: string): TodoItem[] {
    return cloneItems(this.plans.get(sessionId) ?? []);
  }

  add(sessionId: string, text: string): TodoItem {
    const item: TodoItem = { id: randomUUID(), text, status: 'pending' };
    const list = this.plans.get(sessionId) ?? [];
    list.push(item);
    this.plans.set(sessionId, list);
    return cloneItem(item);
  }

  update(sessionId: string, id: string, status: TodoStatus): boolean {
    const list = this.plans.get(sessionId);
    if (!list) return false;
    const item = list.find(candidate => candidate.id === id);
    if (!item) return false;
    item.status = status;
    return true;
  }

  clear(sessionId: string): void {
    this.plans.delete(sessionId);
  }
}

export interface PlanTodoInput {
  action: 'list' | 'add' | 'update' | 'clear';
  text?: string;
  id?: string;
  status?: TodoStatus;
}

export function createPlanTodoTool(service: AgentPlanService): YisiTool {
  return {
    id: 'plan_todo',
    description:
      'Manage the working plan/todo list for this session: add a task, mark it in-progress/done, list pending work, or clear it. Use it to break a multi-step coding task into an ordered checklist and keep it updated as you go. In-memory session state; takes no workspace write.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'clear'] },
        text: { type: 'string', minLength: 1, maxLength: 512 },
        id: { type: 'string', minLength: 1, maxLength: 128 },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }
      },
      required: ['action'],
      additionalProperties: false
    },
    execute: async (input: PlanTodoInput, context) => {
      const sessionId = context.sessionId;
      const action = input.action;
      if (action === 'add') {
        if (typeof input.text !== 'string' || !input.text.trim()) {
          throw new Error('plan_todo: add requires text.');
        }
        return { added: service.add(sessionId, input.text.trim()) };
      }
      if (action === 'update') {
        if (typeof input.id !== 'string' || !input.id.trim() || !isTodoStatus(input.status)) {
          throw new Error('plan_todo: update requires id and a valid status.');
        }
        const updated = service.update(sessionId, input.id, input.status);
        return { updated };
      }
      if (action === 'clear') {
        service.clear(sessionId);
        return { cleared: true };
      }
      return { todos: service.list(sessionId) };
    }
  };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'done';
}

function cloneItems(items: TodoItem[]): TodoItem[] {
  return items.map(cloneItem);
}

function cloneItem(item: TodoItem): TodoItem {
  return { id: item.id, text: item.text, status: item.status };
}
