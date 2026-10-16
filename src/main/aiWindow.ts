import { app, BrowserWindow, nativeTheme } from 'electron';
import { AI_CH } from '../shared/aiChannels';
import { IS_MAC, loadPage, pageUrl, preloadPath } from './paths';

let win: BrowserWindow | null = null;
const goneListeners = new Set<() => void>();

/** Release settings key capture even when the shared window was opened from chat. */
export function onAiWindowGone(callback: () => void): void { goneListeners.add(callback); }
const notifyGone = (): void => { for (const callback of goneListeners) callback(); };

export function aiWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/** One ordinary, interactive window; the ping overlays remain permanently click-through. */
export function openAiWindow(focus = true, target?: string): BrowserWindow {
  const current = aiWindow();
  if (current) {
    const wasVisible = current.isVisible();
    if (focus) {
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
    } else if (!wasVisible || current.isMinimized()) current.showInactive();
    if (focus || !wasVisible) current.webContents.send(AI_CH.navigate, target ?? 'chat');
    return current;
  }
  const w = new BrowserWindow({
    width: 1100, height: 760, minWidth: 760, minHeight: 520, title: 'lolPing', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15191f' : '#f5f7fa',
    webPreferences: { preload: preloadPath('settings'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: !IS_MAC },
  });
  if (!IS_MAC) w.removeMenu();
  w.webContents.on('will-navigate', (event) => {
    const own = new URL(pageUrl('chat'));
    try {
      const next = new URL(event.url);
      if (next.protocol !== own.protocol || next.host !== own.host || next.pathname !== own.pathname) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('render-process-gone', notifyGone);
  w.once('ready-to-show', () => {
    if (IS_MAC) void app.dock?.show();
    if (focus) w.show(); else w.showInactive();
  });
  w.on('closed', () => {
    win = null;
    notifyGone();
    if (IS_MAC && !BrowserWindow.getAllWindows().some((other) => other.isFocusable())) app.dock?.hide();
  });
  void loadPage(w, 'chat', target ?? 'chat');
  win = w;
  return w;
}
