import { YisiTool } from '../../domain/tool';
import { AgentToolDefinition, parseAgentToolDefinition } from '../../llm/types';

export class ToolRegistry {
  private readonly tools = new Map<string, YisiTool>();
  private readonly publicDefinitions: AgentToolDefinition[];

  constructor(tools: readonly YisiTool[]) {
    this.publicDefinitions = tools.map(tool => {
      if (this.tools.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
      this.tools.set(tool.id, tool);
      return parseAgentToolDefinition({
        name: tool.id,
        description: tool.description,
        parameters: tool.inputSchema
      });
    });
  }

  get(id: string): YisiTool | undefined {
    return this.tools.get(id);
  }

  definitions(): AgentToolDefinition[] {
    return this.publicDefinitions.map(definition => parseAgentToolDefinition(definition));
  }
}
