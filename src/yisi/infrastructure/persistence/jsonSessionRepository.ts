import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { SessionRepository } from '../../application/session/sessionRepository';
import { SessionDocument, parseSessionDocument } from '../../domain/session';

const DEFAULT_FILE_NAME = 'sessions-v1.json';

export class SessionPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionPersistenceError';
  }
}

export class JsonSessionRepository implements SessionRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDirectory: string,
    private readonly fileName = DEFAULT_FILE_NAME
  ) {}

  async load(): Promise<SessionDocument | undefined> {
    await this.queue;
    try {
      const serialized = await readFile(this.targetPath, 'utf8');
      return parseSessionDocument(JSON.parse(serialized) as unknown);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw new SessionPersistenceError('Unable to read persisted sessions.', { cause: error });
    }
  }

  save(document: SessionDocument): Promise<void> {
    const snapshot = parseSessionDocument(document);
    const pending = this.queue.then(() => this.writeAtomically(snapshot));
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private get targetPath(): string {
    return join(this.storageDirectory, this.fileName);
  }

  private async writeAtomically(document: SessionDocument): Promise<void> {
    const temporaryPath = join(
      this.storageDirectory,
      `.${this.fileName}.${randomUUID()}.tmp`
    );

    try {
      await mkdir(this.storageDirectory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(document, undefined, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.targetPath);
    } catch (error: unknown) {
      throw new SessionPersistenceError('Unable to persist sessions.', { cause: error });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
