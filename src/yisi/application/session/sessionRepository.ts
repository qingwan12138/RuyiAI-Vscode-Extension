import { SessionDocument } from '../../domain/session';

export interface SessionRepository {
  load(): Promise<SessionDocument | undefined>;
  save(document: SessionDocument): Promise<void>;
}
