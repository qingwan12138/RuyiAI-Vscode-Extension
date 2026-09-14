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

  /** The registered tools, in registration order. */
  list(): YisiTool[] {
    return [...this.tools.values()];
  }

  /**
   * A registry holding only the tools matching `predicate`. Used to give a
   * subagent a strictly smaller tool set than its parent — a subset by
   * construction rather than by convention.
   */
  subset(predicate: (tool: YisiTool) => boolean): ToolRegistry {
    return new ToolRegistry(this.list().filter(predicate));
  }

  definitions(): AgentToolDefinition[] {
    return this.publicDefinitions.map(definition => parseAgentToolDefinition(definition));
  }
}
