import { describe, expect, it } from 'vitest';
import { normalizeAiConfig, normalizeAiHistory, normalizeSearchSources, validAiUrl } from '../../src/shared/ai';
import { normalizeSettings } from '../../src/shared/settings';

describe('AI validation', () => {
  it('keeps automation switches independent and normalizes custom shortcuts', () => {
    const config = normalizeAiConfig({ recognitionEnabled: true, recognitionHotkey: { mods: 3, vk: 73 },
      timersHotkey: { mods: 0, vk: 84 } });
    expect(config.recognitionEnabled).toBe(true);
    expect(config.timersEnabled).toBe(false);
    expect(config.recognitionHotkey).toEqual({ mods: 3, vk: 73 });
    expect(config.timersHotkey).toBeNull();
  });

  it('defaults old settings and strips keys from profiles', () => {
    expect(normalizeSettings({}).ai).toEqual({ profiles: [], defaultChatProfileId: null,
      defaultVisionProfileId: null, paused: false, visionMinutes: 5, searchEnabled: false,
      recognitionEnabled: false, timersEnabled: false, recognitionHotkey: null, timersHotkey: null });
    const ai = normalizeAiConfig({ profiles: [{ id: 'p', name: 'Test', baseUrl: 'https://example.com/v1',
      model: 'model', supportsVision: false, apiKey: 'secret' }], defaultChatProfileId: 'p',
      defaultVisionProfileId: 'p', visionMinutes: 90 });
    expect(ai.defaultChatProfileId).toBe('p');
    expect(ai.defaultVisionProfileId).toBeNull();
    expect(ai.visionMinutes).toBe(60);
    expect(JSON.stringify(ai)).not.toContain('secret');
  });

  it('permits secure remote and local HTTP endpoints only', () => {
    for (const url of ['https://api.example.com/v1', 'http://localhost:1234/v1', 'http://127.0.0.1:8', 'http://192.168.1.5:8080']) {
      expect(validAiUrl(url)).toBe(true);
    }
    for (const url of ['http://api.example.com', 'file:///etc/passwd', 'https://u:password@example.com', 'https://example.com/?key=secret']) {
      expect(validAiUrl(url)).toBe(false);
    }
  });

  it('drops image bytes and unknown fields and marks interrupted histories cancelled', () => {
    const history = normalizeAiHistory([{ id: 'c', profileId: 'p', title: 'Title', status: 'running',
      secret: 'secret', messages: [{ id: 'm', role: 'user', content: 'hello', image: 'data:image/png;base64,AA==' },
        { id: 'n', role: 'assistant', content: 'data:image/png;base64,AA==' }] }]);
    expect(history[0]?.status).toBe('cancelled');
    expect(history[0]?.messages).toEqual([{ id: 'm', role: 'user', content: 'hello' }]);
    expect(JSON.stringify(history)).not.toContain('base64');
  });

  it('rejects source URLs exceeding the UTF-8 byte limit', () => {
    const url = `https://example.org/${'界'.repeat(700)}`;
    expect(normalizeSearchSources([{ title: 'Long URL', url }])).toHaveLength(0);
  });

  it('keeps the newest question and answer when older messages exhaust history capacity', () => {
    const messages = Array.from({ length: 98 }, (_, index) => ({ id: `old${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant', content: '界'.repeat(32768) }));
    messages.push({ id: 'new-question', role: 'user', content: 'new question' },
      { id: 'new-answer', role: 'assistant', content: 'new answer' });
    const result = normalizeAiHistory([{ id: 'c', title: 'C', profileId: 'p', status: 'completed', messages }]);
    expect(result[0]?.messages.slice(-2).map((message) => message.id)).toEqual(['new-question', 'new-answer']);
  });
});
