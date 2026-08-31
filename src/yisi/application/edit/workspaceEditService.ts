import { YisiTool } from '../../domain/tool';
import {
  WorkspaceTextReplacement,
  WorkspaceTextReplacementResult,
  WorkspaceWritePort
} from '../../context/workspaceContext';

const MAX_PATH_CHARACTERS = 4_096;
const MAX_REPLACEMENT_CHARACTERS = 65_536;

export class WorkspaceEditInputError extends Error {
  constructor(message = 'Invalid workspace edit input.') {
    super(message);
    this.name = 'WorkspaceEditInputError';
  }
}

export class WorkspaceEditService {
  constructor(private readonly files: WorkspaceWritePort) {}

  async replaceText(input: unknown, signal: AbortSignal): Promise<WorkspaceTextReplacementResult> {
    return this.files.replaceText(parseReplacement(input), signal);
  }
}

export function createWorkspaceEditTool(service: WorkspaceEditService): YisiTool {
  return {
    id: 'replace_text',
    description: 'Replace exactly one occurrence in an existing UTF-8 workspace file. First read the file and pass its sha256 as expectedSha256.',
    risk: 'workspaceWrite',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_CHARACTERS },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        oldText: { type: 'string', minLength: 1, maxLength: MAX_REPLACEMENT_CHARACTERS },
        newText: { type: 'string', maxLength: MAX_REPLACEMENT_CHARACTERS }
      },
      required: ['path', 'expectedSha256', 'oldText', 'newText'],
      additionalProperties: false
    },
    execute: (input, context) => service.replaceText(input, context.signal)
  };
}

function parseReplacement(value: unknown): WorkspaceTextReplacement {
  if (!isExactRecord(value, ['path', 'expectedSha256', 'oldText', 'newText'])) {
    throw new WorkspaceEditInputError();
  }
  if (
    !isBoundedNonBlank(value.path, MAX_PATH_CHARACTERS)
    || typeof value.expectedSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256)
    || !isBoundedNonEmpty(value.oldText, MAX_REPLACEMENT_CHARACTERS)
    || typeof value.newText !== 'string'
    || value.newText.length > MAX_REPLACEMENT_CHARACTERS
    || value.newText.includes('\0')
  ) {
    throw new WorkspaceEditInputError();
  }
  return {
    path: value.path.trim(),
    expectedSha256: value.expectedSha256,
    oldText: value.oldText,
    newText: value.newText
  };
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedNonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isBoundedNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}
