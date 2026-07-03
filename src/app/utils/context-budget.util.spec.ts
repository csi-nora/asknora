import { DEFAULT_SYSTEM_PROMPT_MAX_CHARS, softCapSystemPrompt } from './context-budget.util';

describe('softCapSystemPrompt', () => {
  it('returns unchanged when under budget', () => {
    const s = 'short';
    expect(softCapSystemPrompt(s, 100)).toBe(s);
  });

  it('truncates and appends marker when over budget', () => {
    const long = 'x'.repeat(DEFAULT_SYSTEM_PROMPT_MAX_CHARS + 500);
    const out = softCapSystemPrompt(long, DEFAULT_SYSTEM_PROMPT_MAX_CHARS);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_SYSTEM_PROMPT_MAX_CHARS);
    expect(out.includes('truncated')).toBe(true);
  });
});
