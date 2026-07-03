import { ChatMessage } from '../models';

const MAX_DEFAULT_TURNS = 8;

/**
 * Build OpenAI-style alternating history for the LLM.
 * ChatPanel adds the user message to state before calling HybridApiService.send(); this helper
 * avoids duplicating that final user turn in the payload (which degrades coherence).
 */
export function buildLlmHistory(
  messages: ChatMessage[],
  currentUserQuery: string,
  maxTurns: number = MAX_DEFAULT_TURNS
): { role: string; content: string }[] {
  const slice = messages.slice(-maxTurns);
  const history = slice.map(m => ({
    role: m.role === 'nora' ? 'assistant' : 'user',
    content: m.content,
  }));
  const last = history[history.length - 1];
  if (last?.role === 'user' && last.content === currentUserQuery) {
    return history;
  }
  return [...history, { role: 'user', content: currentUserQuery }];
}
