/** Conservative cap for bundled RAG + sector text sent as a single system string. */
export const DEFAULT_SYSTEM_PROMPT_MAX_CHARS = 24_000;

export function softCapSystemPrompt(text: string, maxChars: number = DEFAULT_SYSTEM_PROMPT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const marker = '\n\n[Context truncated for length — answer using the preceding text; cite sources where possible.]';
  const budget = maxChars - marker.length;
  return text.slice(0, Math.max(0, budget)) + marker;
}
