export interface ValidationStep {
  kind: 'diagnostics' | 'build' | 'test' | 'lint' | 'typecheck' | 'ruyi';
  command?: string;
}

export interface ValidationResult {
  passed: boolean;
  steps: Array<{ step: ValidationStep; passed: boolean; summary: string }>;
}

export class ValidationEngine {
  async validate(steps: ValidationStep[]): Promise<ValidationResult> {
    // Placeholder: real implementation wires VS Code diagnostics + terminal/process runner.
    return {
      passed: steps.length === 0,
      steps: steps.map(step => ({ step, passed: false, summary: 'Not implemented in starter.' }))
    };
  }
}
