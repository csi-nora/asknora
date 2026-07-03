import type { AppEnvironment } from '../models';

/** Path prefix on CSI Nora gateway; proxies to upstream LLM APIs. */
export const LLM_GATEWAY_PREFIX = '/api/llm';

export function useBackendGateway(env: AppEnvironment): boolean {
  if ((env.backendBaseUrl || '').trim()) {
    return true;
  }
  return !!(env.production && env.preferTokenBackend);
}

function origin(env: AppEnvironment): string {
  return (env.backendBaseUrl || '').replace(/\/$/, '');
}

export function anthropicMessagesUrl(env: AppEnvironment): string {
  const o = origin(env);
  if (!o) return 'https://api.anthropic.com/v1/messages';
  return `${o}${LLM_GATEWAY_PREFIX}/anthropic/v1/messages`;
}

export function openaiModelsUrl(env: AppEnvironment): string {
  const o = origin(env);
  if (!o) return 'https://api.openai.com/v1/models';
  return `${o}${LLM_GATEWAY_PREFIX}/openai/v1/models`;
}

export function openaiChatCompletionsUrl(env: AppEnvironment): string {
  const o = origin(env);
  if (!o) return 'https://api.openai.com/v1/chat/completions';
  return `${o}${LLM_GATEWAY_PREFIX}/openai/v1/chat/completions`;
}

export function hfInferenceModelUrl(env: AppEnvironment, model: string): string {
  const o = origin(env);
  if (!o) return `https://api-inference.huggingface.co/models/${model}`;
  return `${o}${LLM_GATEWAY_PREFIX}/hf-inference/models/${model}`;
}

export function hfWhoamiUrl(env: AppEnvironment): string {
  const o = origin(env);
  if (!o) return 'https://huggingface.co/api/whoami-v2';
  return `${o}${LLM_GATEWAY_PREFIX}/hf-meta/api/whoami-v2`;
}

/** Lightweight HF reachability check when not using gateway (no token). */
export function hfPublicHeadUrl(): string {
  return 'https://huggingface.co';
}
