import { ExplicitFileContext } from '../chat/chatService';

export interface ExplicitContextPicker {
  pickFile(signal?: AbortSignal): Promise<ExplicitFileContext | undefined>;
}
