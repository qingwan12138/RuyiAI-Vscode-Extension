import { RuyiCommandResult, RuyiManageAction, RuyiPort } from '../../ruyi/ruyiPort';
import { YisiTool } from '../../domain/tool';

/** Typed Ruyi operations that change the local SDK environment (v0.5). */
export class RuyiManageService {
  constructor(private readonly ruyi: RuyiPort) {}

  async run(action: RuyiManageAction, signal?: AbortSignal): Promise<RuyiCommandResult> {
    switch (action.action) {
      case 'install': return this.ruyi.installPackage(action.packageId, action.version);
      case 'uninstall': return this.ruyi.uninstallPackage(action.packageId);
      case 'venv_create': return this.ruyi.createVenv(action.name, action.packageId);
      case 'venv_remove': return this.ruyi.removeVenv(action.name);
      case 'profile_create': return this.ruyi.createProfile(action.name, action.packageId);
      case 'profile_remove': return this.ruyi.removeProfile(action.name);
      case 'update': return this.ruyi.update();
      case 'extract': return this.ruyi.extract(action.packageId);
    }
  }
}

const REQUIRED_FIELDS: Record<RuyiManageAction['action'], string[]> = {
  install: ['packageId'],
  uninstall: ['packageId'],
  venv_create: ['name'],
  venv_remove: ['name'],
  profile_create: ['name'],
  profile_remove: ['name'],
  update: [],
  extract: ['packageId']
};

export function createRuyiManageTool(service: RuyiManageService): YisiTool {
  return {
    id: 'ruyi_manage',
    description:
      'Run a typed RuyiSDK environment operation (install/uninstall a package, create/remove a venv or profile, refresh packages, extract a toolchain). All operations go through `ruyi --porcelain`; this action changes the local SDK environment and is permission-gated. When ruyi is unavailable it reports that instead of failing.',
    risk: 'environmentChange',
    mutatesWorkspace: true,
    supportsCancellation: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['install', 'uninstall', 'venv_create', 'venv_remove', 'profile_create', 'profile_remove', 'update', 'extract'] },
        packageId: { type: 'string', minLength: 1, maxLength: 256 },
        name: { type: 'string', minLength: 1, maxLength: 128 },
        version: { type: 'string', minLength: 1, maxLength: 64 }
      },
      required: ['action'],
      additionalProperties: false
    },
    execute: async (input, context) => {
      const action = normalizeAction(input);
      const result = await service.run(action, context.signal);
      return {
        code: result.code,
        ...(result.records.length > 0 ? { records: result.records } : {}),
        ...(result.stderr.trim() ? { stderr: result.stderr.slice(0, 400) } : {}),
        message: result.code === 0
          ? 'ruyi operation completed successfully.'
          : `ruyi operation failed with exit code ${result.code}.`
      };
    }
  };
}

function normalizeAction(input: unknown): RuyiManageAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('ruyi_manage: invalid input.');
  }
  const value = input as Record<string, unknown>;
  const actionName = enumAction(value.action);
  const required = REQUIRED_FIELDS[actionName];
  for (const field of required) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) {
      throw new Error(`ruyi_manage: "${field}" is required for ${actionName}.`);
    }
  }
  switch (actionName) {
    case 'install': return { action: 'install', packageId: value.packageId as string, ...(typeof value.version === 'string' ? { version: value.version } : {}) };
    case 'uninstall': return { action: 'uninstall', packageId: value.packageId as string };
    case 'venv_create': return { action: 'venv_create', name: value.name as string, ...(typeof value.packageId === 'string' ? { packageId: value.packageId } : {}) };
    case 'venv_remove': return { action: 'venv_remove', name: value.name as string };
    case 'profile_create': return { action: 'profile_create', name: value.name as string, ...(typeof value.packageId === 'string' ? { packageId: value.packageId } : {}) };
    case 'profile_remove': return { action: 'profile_remove', name: value.name as string };
    case 'update': return { action: 'update' };
    case 'extract': return { action: 'extract', packageId: value.packageId as string };
  }
}

function enumAction(value: unknown): RuyiManageAction['action'] {
  if (typeof value !== 'string') throw new Error('ruyi_manage: "action" is required.');
  const allowed = ['install', 'uninstall', 'venv_create', 'venv_remove', 'profile_create', 'profile_remove', 'update', 'extract'];
  if (!allowed.includes(value)) throw new Error(`ruyi_manage: unknown action "${value}".`);
  return value as RuyiManageAction['action'];
}
