import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_CH } from '../../src/shared/aiChannels';

const state = vi.hoisted(() => ({ windows: [] as unknown[], sent: [] as Array<[string, unknown]> }));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Contents extends Emitter {
    send(channel: string, payload: unknown): void { state.sent.push([channel, payload]); }
    setWindowOpenHandler(): void {}
  }
  class Window extends Emitter {
    webContents = new Contents();
    visible = false;
    constructor(readonly options: { webPreferences: { preload: string } }) { super(); state.windows.push(this); }
    isDestroyed(): boolean { return false; }
    isMinimized(): boolean { return false; }
    isVisible(): boolean { return this.visible; }
    removeMenu(): void {}
    restore(): void {}
    show(): void { this.visible = true; }
    showInactive(): void { this.visible = true; }
    focus(): void {}
  }
  return { BrowserWindow: Window, nativeTheme: Object.assign(new Emitter(), { shouldUseDarkColors: false }),
    nativeImage: { createFromPath: () => ({}) } };
});
vi.mock('../../src/main/paths', () => ({ IS_MAC: false, IS_LINUX: false,
  assetPath: () => 'icon', preloadPath: (name: string) => `${name}.js`, loadPage: async () => undefined,
  pageUrl: (name: string) => `lolping://app/${name}/index.html` }));

type TestWindow = EventEmitter & { webContents: EventEmitter; options: { webPreferences: { preload: string } } };
beforeEach(() => { vi.resetModules(); state.windows.length = 0; state.sent.length = 0; });

describe('unified main window', () => {
  it('reuses one native window for chat, model services and application settings', async () => {
    const chat = await import('../../src/main/aiWindow');
    const settings = await import('../../src/main/settingsWindow');
    const first = chat.openAiWindow();
    first.emit('ready-to-show');
    expect(settings.openSettingsWindow('trigger')).toBe(first);
    expect(settings.openSettingsWindow('ai')).toBe(first);
    expect(state.windows).toHaveLength(1);
    expect(state.sent).toContainEqual([AI_CH.navigate, 'settings-trigger']);
    expect(state.sent).toContainEqual([AI_CH.navigate, 'models']);
    expect((state.windows[0] as TestWindow).options.webPreferences.preload).toBe('settings.js');
  });

  it('releases settings key capture when a window opened from chat closes or crashes', async () => {
    const chat = await import('../../src/main/aiWindow');
    const settings = await import('../../src/main/settingsWindow');
    const released = vi.fn();
    settings.onSettingsWindowGone(released);
    const window = chat.openAiWindow();
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(released).toHaveBeenCalledTimes(1);
    window.emit('closed');
    expect(released).toHaveBeenCalledTimes(2);
  });

  it('keeps a visible settings pane in place when a background task completes', async () => {
    const chat = await import('../../src/main/aiWindow');
    const settings = await import('../../src/main/settingsWindow');
    const window = settings.openSettingsWindow();
    window.emit('ready-to-show');
    state.sent.length = 0;
    expect(chat.openAiWindow(false, 'completed-conversation')).toBe(window);
    expect(state.sent).toEqual([]);
    expect(state.windows).toHaveLength(1);
  });
});
