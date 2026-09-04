// Local inference device presets for the Provider wizard (B1).
//
// Contract G5: the fine-tuned local model must be callable "directly from the
// IDE" on local RISC-V devices (如意香山南湖笔记本 / 如意 AIPC) and on plain
// Linux. llama.cpp servers expose an OpenAI-compatible /v1 endpoint, so these
// presets pre-fill a llamaCpp provider: base URL, suggested model ids and a
// no-credential default. IPs are device-specific, so presets always start from
// the loopback URL and instruct the user to edit it; the wizard keeps its
// built-in Test Connection / model discovery steps.

export interface LocalDevicePreset {
  id: string;
  label: string;
  detail: string;
  /** OpenAI-compatible /v1 base URL prefilled into the wizard. */
  baseUrl: string;
  /** Suggested model ids, editable before saving. */
  suggestedModels: string[];
  /** Provider kind the preset applies to. */
  providerKind: 'llamaCpp';
  /** Extra capability toggles applied to the draft (all booleans here). */
  capabilities: {
    toolCalling: boolean;
    temperature: boolean;
    maxTokens: boolean;
    speedMode: boolean;
  };
}

export const LOCAL_DEVICE_PRESETS: readonly LocalDevicePreset[] = [
  {
    id: 'linux-llamacpp',
    label: '本机 llama.cpp server',
    detail: 'http://127.0.0.1:8080/v1 — llama.cpp/server 或任意 OpenAI-compatible 本地服务',
    baseUrl: 'http://127.0.0.1:8080/v1',
    suggestedModels: ['local-model'],
    providerKind: 'llamaCpp',
    capabilities: { toolCalling: true, temperature: true, maxTokens: true, speedMode: false }
  },
  {
    id: 'ruyi-nandbook',
    label: '如意香山南湖笔记本 (RISC-V)',
    detail: '把 Base URL 里的 127.0.0.1 换成笔记本局域网 IP（默认端口 8080）；llama.cpp/buddy-compiler 推理端',
    baseUrl: 'http://127.0.0.1:8080/v1',
    suggestedModels: ['local-model'],
    providerKind: 'llamaCpp',
    capabilities: { toolCalling: true, temperature: true, maxTokens: true, speedMode: false }
  },
  {
    id: 'ruyi-aipc',
    label: '如意 AIPC',
    detail: '把 Base URL 里的 127.0.0.1 换成 AIPC 的 IP（默认端口 8080）',
    baseUrl: 'http://127.0.0.1:8080/v1',
    suggestedModels: ['local-model'],
    providerKind: 'llamaCpp',
    capabilities: { toolCalling: true, temperature: true, maxTokens: true, speedMode: false }
  }
];

export function localDevicePresetById(id: string): LocalDevicePreset | undefined {
  return LOCAL_DEVICE_PRESETS.find(preset => preset.id === id);
}
