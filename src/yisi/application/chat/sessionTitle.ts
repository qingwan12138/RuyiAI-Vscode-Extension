// Session auto-titling.
//
// A session is created with the placeholder title "New Chat" (titleSource
// 'fallback'). Once its first exchange has completed, the same provider the chat
// uses is asked for a short title and the session is renamed with titleSource
// 'ai'. A user rename always wins, so this can never overwrite a name the user
// typed.
//
// Prompt assembly and reply cleanup are pure functions of the conversation, so
// they are unit-testable without a provider (see test/session-title.test.js).

import { ChatMessage } from '../../llm/types';
import { ConversationItem } from '../../domain/session';

/** Read by the composition root. The application layer never imports vscode. */
export interface SessionAutoTitlePolicy {
  enabled: boolean;
}

/** Sessions are listed in a narrow sidebar, so a long title is not a title. */
export const SESSION_TITLE_MAX_CHARS = 48;
/** How much of each side of the first exchange is actually sent. */
const EXCERPT_MAX_CHARS = 1200;

const SYSTEM_PROMPT = [
  'You name chat sessions.',
  'Write a title of at most 6 words describing the task.',
  'Use the same language as the user.',
  'Reply with the title only: no quotes, no label, no closing punctuation, no explanation.'
].join(' ');

/**
 * Whether this session still needs a name. True only while the placeholder is in
 * place ('fallback') and the first provider reply has landed, so a run that
 * failed before answering does not title the session from a lone user message.
 * `manual` means the user owns the name, `ai` means it is already named.
 */
export function shouldGenerateSessionTitle(session: {
  titleSource: 'manual' | 'ai' | 'fallback';
  items: readonly ConversationItem[];
}): boolean {
  if (session.titleSource !== 'fallback') return false;
  return session.items.some(item => item.type === 'assistantMessage' && item.source === 'provider');
}

/** A bare request: a system instruction plus the first exchange, nothing else. */
export function buildSessionTitleMessages(items: readonly ConversationItem[]): ChatMessage[] {
  const firstUser = items.find(item => item.type === 'userMessage');
  const firstAssistant = items.find(item => item.type === 'assistantMessage' && item.source === 'provider');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `User: ${excerpt(firstUser?.text ?? '')}`,
        `Assistant: ${excerpt(firstAssistant?.text ?? '')}`,
        '',
        'Title:'
      ].join('\n')
    }
  ];
}

function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= EXCERPT_MAX_CHARS ? collapsed : `${collapsed.slice(0, EXCERPT_MAX_CHARS)}…`;
}

/**
 * Turns a raw model reply into a usable title, or undefined when nothing usable
 * came back. Models routinely wrap the answer in quotes, prefix it with a label
 * such as "Title:", answer with a Markdown heading, or add a line of prose after
 * the title.
 */
export function parseSessionTitle(raw: string): string | undefined {
  if (typeof raw !== 'string') return undefined;

  // Drop fences first: a fenced reply would otherwise present "```" as its first
  // non-empty line and clean up to nothing.
  const withoutFences = raw.replace(/```[a-zA-Z]*/g, ' ');
  const firstLine = withoutFences.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0) ?? '';
  let value = firstLine;
  value = value.replace(/^(?:session\s+)?(?:title|标题|会话标题|名称|主题)\s*[:：]\s*/i, '');
  value = value.replace(/^[#*>\s]+/, '');
  value = value.replace(/^["'“”‘’`「『《〈\[]+/, '');
  value = value.replace(/["'“”‘’`」』》〉\]]+$/, '');
  value = value.replace(/[.。;；,，!！?？~～、\s]+$/, '');
  value = value.replace(/\s{2,}/g, ' ').trim();

  if (!value) return undefined;
  if (value.length > SESSION_TITLE_MAX_CHARS) {
    value = value.slice(0, SESSION_TITLE_MAX_CHARS).replace(/[.。;；,，!！?？~～、\s]+$/, '').trim();
  }
  return value || undefined;
}
