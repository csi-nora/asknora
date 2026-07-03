import { ChatMessage } from '../models';
import { buildLlmHistory } from './llm-history.util';

describe('buildLlmHistory', () => {
  it('does not duplicate when last state message is the current user query', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: '1' },
      { id: 'n1', role: 'nora', content: 'Hi there.', timestamp: '2' },
      { id: 'u2', role: 'user', content: 'What is MDR for healthcare?', timestamp: '3' },
    ];
    const h = buildLlmHistory(messages, 'What is MDR for healthcare?');
    const dup = h.filter(x => x.role === 'user' && x.content === 'What is MDR for healthcare?');
    expect(dup.length).toBe(1);
    expect(h[h.length - 1].role).toBe('user');
  });

  it('appends user query when not yet in state (defensive)', () => {
    const messages: ChatMessage[] = [{ id: 'n0', role: 'nora', content: 'Earlier reply', timestamp: '1' }];
    const h = buildLlmHistory(messages, 'New question');
    expect(h[h.length - 1]).toEqual({ role: 'user', content: 'New question' });
  });

  it('respects maxTurns window', () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) =>
      ({
        id: `m${i}`,
        role: i % 2 === 0 ? 'user' : 'nora',
        content: `m${i}`,
        timestamp: `${i}`,
      } as ChatMessage));
    const h = buildLlmHistory(messages, 'm18', 4);
    expect(h.length).toBeLessThanOrEqual(5);
  });
});
