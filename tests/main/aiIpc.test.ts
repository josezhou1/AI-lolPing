import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../src/main/aiService';
import { registerAiIpc } from '../../src/main/aiIpc';
import { normalizeAiConfig, type AiConfig } from '../../src/shared/ai';
import { AI_CH } from '../../src/shared/aiChannels';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  opened: [] as string[],
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async (url: string) => { h.opened.push(url); } },
}));

beforeEach(() => { h.handlers.clear(); h.opened.length = 0; });

describe('AI IPC boundary', () => {
  function setup() {
    let config: AiConfig = normalizeAiConfig(undefined);
    const service = new AiService({ getConfig: () => config, updateConfig: (next) => { config = next; },
      credentials: { get: () => undefined, ids: () => [], set: async () => undefined, delete: async () => undefined },
      history: { load: () => [], save: async () => undefined, flush: async () => undefined } });
    const sender = { mainFrame: {} };
    registerAiIpc({ service, trusted: (raw) => raw === sender, openChat: () => undefined,
      openSettings: () => undefined, locale: () => ({ language: 'en', locale: 'en', platform: 'win' }) });
    const invoke = (channel: string, event: unknown, ...args: unknown[]) =>
      Promise.resolve().then(() => h.handlers.get(channel)?.(event, ...args));
    return { service, sender, invoke };
  }

  it('rejects unrelated windows and subframes before changing persistent pause state', async () => {
    const { service, sender, invoke } = setup();
    await expect(invoke(AI_CH.configure, { sender: {}, senderFrame: {} }, { paused: true }))
      .rejects.toThrow('ai_invalid_input');
    await expect(invoke(AI_CH.configure, { sender, senderFrame: {} }, { paused: true }))
      .rejects.toThrow('ai_invalid_input');
    expect(service.snapshot().config.paused).toBe(false);
    await invoke(AI_CH.configure, { sender, senderFrame: sender.mainFrame }, { paused: true });
    expect(service.snapshot().config.paused).toBe(true);
    await service.close();
  });

  it('rejects non-web links and fractional timer durations at the renderer boundary', async () => {
    const { service, sender, invoke } = setup();
    const event = { sender, senderFrame: sender.mainFrame };
    await expect(invoke(AI_CH.openExternal, event, 'javascript:alert(1)')).rejects.toThrow('ai_invalid_input');
    expect(h.opened).toEqual([]);
    const timer = service.addTimer({ displayId: 1, x: 50, y: 50, width: 1920, height: 1080 });
    await expect(invoke(AI_CH.adjustTimer, event, timer.id, 0.5)).rejects.toThrow('ai_invalid_input');
    expect(service.snapshot().timers[0]?.dueAt).toBe(timer.dueAt);
    await invoke(AI_CH.openExternal, event, 'https://example.com/source');
    expect(h.opened).toEqual(['https://example.com/source']);
    await service.close();
  });

  it('includes locale metadata in the initial snapshot without exposing credentials', async () => {
    const { service, sender, invoke } = setup();
    const snapshot = await invoke(AI_CH.snapshot, { sender, senderFrame: sender.mainFrame });
    expect(snapshot).toMatchObject({ locale: { language: 'en', locale: 'en', platform: 'win' }, credentialIds: [] });
    await service.close();
  });
});
