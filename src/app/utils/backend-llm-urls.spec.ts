import type { AppEnvironment } from '../models';
import {
  anthropicMessagesUrl,
  hfInferenceModelUrl,
  hfWhoamiUrl,
  openaiChatCompletionsUrl,
  openaiModelsUrl,
  useBackendGateway,
} from './backend-llm-urls';

describe('backend-llm-urls', () => {
  const direct: AppEnvironment = {
    production: false,
    deploymentTier: 'sandbox',
    allowUatOverride: true,
    appVersion: '1',
    backendBaseUrl: '',
    preferTokenBackend: false,
  };

  const gated: AppEnvironment = {
    ...direct,
    backendBaseUrl: 'https://gw.example.com',
    preferTokenBackend: true,
  };

  it('useBackendGateway is false when backendBaseUrl empty', () => {
    expect(useBackendGateway(direct)).toBe(false);
  });

  it('useBackendGateway is true when backendBaseUrl set', () => {
    expect(useBackendGateway(gated)).toBe(true);
  });

  it('direct URLs match upstream providers', () => {
    expect(anthropicMessagesUrl(direct)).toBe('https://api.anthropic.com/v1/messages');
    expect(openaiModelsUrl(direct)).toBe('https://api.openai.com/v1/models');
    expect(openaiChatCompletionsUrl(direct)).toBe('https://api.openai.com/v1/chat/completions');
    expect(hfInferenceModelUrl(direct, 'm/hf')).toBe('https://api-inference.huggingface.co/models/m/hf');
    expect(hfWhoamiUrl(direct)).toBe('https://huggingface.co/api/whoami-v2');
  });

  it('gateway URLs are under origin + /api/llm', () => {
    expect(anthropicMessagesUrl(gated)).toBe('https://gw.example.com/api/llm/anthropic/v1/messages');
    expect(hfInferenceModelUrl(gated, 'org/model')).toBe(
      'https://gw.example.com/api/llm/hf-inference/models/org/model',
    );
  });

  it('strips trailing slash from backendBaseUrl', () => {
    const env: AppEnvironment = { ...gated, backendBaseUrl: 'https://gw.example.com/' };
    expect(anthropicMessagesUrl(env)).toBe('https://gw.example.com/api/llm/anthropic/v1/messages');
  });
});
