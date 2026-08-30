import { CapturedOutput } from '../../domain/process';

const TRUNCATION_MARKER = Buffer.from('\n… output truncated …\n', 'utf8');

export class BoundedOutput {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private retained = Buffer.alloc(0);
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;
  private truncated = false;

  constructor(private readonly limitBytes: number) {
    if (!Number.isInteger(limitBytes) || limitBytes <= 0) {
      throw new Error('Output limit must be a positive integer.');
    }
    this.headLimit = Math.ceil(limitBytes / 2);
    this.tailLimit = limitBytes - this.headLimit;
  }

  append(chunk: Uint8Array | string): void {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    if (bytes.length === 0) return;
    this.totalBytes += bytes.length;

    if (!this.truncated) {
      const combined = Buffer.concat([this.retained, bytes]);
      if (combined.length <= this.limitBytes) {
        this.retained = combined;
        return;
      }
      this.truncated = true;
      this.head = combined.subarray(0, this.headLimit);
      this.tail = this.tailLimit === 0 ? Buffer.alloc(0) : combined.subarray(combined.length - this.tailLimit);
      this.retained = Buffer.alloc(0);
      return;
    }

    if (this.tailLimit > 0) {
      const combinedTail = Buffer.concat([this.tail, bytes]);
      this.tail = combinedTail.subarray(Math.max(0, combinedTail.length - this.tailLimit));
    }
  }

  snapshot(): CapturedOutput {
    const retained = this.truncated
      ? Buffer.concat([this.head, TRUNCATION_MARKER, this.tail])
      : this.retained;
    return {
      text: retained.toString('utf8'),
      totalBytes: this.totalBytes,
      retainedBytes: this.truncated ? this.head.length + this.tail.length : this.retained.length,
      truncated: this.truncated
    };
  }
}
