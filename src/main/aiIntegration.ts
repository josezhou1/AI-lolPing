import { app, desktopCapturer, Notification, powerMonitor, safeStorage, screen } from 'electron';
import { aiErrorCode, type AiPoint, type AiSnapshot, type VisionTimer } from '../shared/ai';
import { AI_CH } from '../shared/aiChannels';
import type { Strings } from '../shared/i18n';
import { registerAiIpc } from './aiIpc';
import { AiService } from './aiService';
import { FileAiCredentialStore, FileAiHistoryStore } from './aiStorage';
import { aiWindow, openAiWindow } from './aiWindow';
import { pageUrl, PLATFORM } from './paths';
import type { OverlayManager, SharedPing } from './overlayManager';
import { ScreenCaptureService } from './screenCapture';
import type { SettingsStore } from './settingsStore';
import { openSettingsWindow } from './settingsWindow';

/** Wires desktop-only operations to the testable AI task service. */
export function startAiIntegration(store: SettingsStore, overlays: OverlayManager, text: () => Strings) {
  let closed = false;
  const notifications = new Set<Notification>();
  const locale = () => ({ language: store.get().language, locale: app.getLocale(), platform: PLATFORM });
  const consumers = () => [aiWindow()].filter((w) => w && !w.webContents.isDestroyed());
  const push = (snapshot: AiSnapshot): void => {
    if (closed) return;
    const state: AiSnapshot = { ...snapshot, locale: locale() };
    for (const w of consumers()) w?.webContents.send(AI_CH.changed, state);
  };
  const changedSettings = (): void => { if (consumers().length) push(service.snapshot()); };
  const pointValid = (p: { displayId: number; x: number; y: number }): boolean => {
    const display = screen.getAllDisplays().find((d) => d.id === p.displayId);
    return !!display && p.x >= 0 && p.y >= 0 && p.x < display.bounds.width && p.y < display.bounds.height;
  };
  const showAt = (p: { displayId: number; x: number; y: number }, id: 'omw' | 'enemyvision'): void => {
    if (closed) return;
    if (pointValid(p)) overlays.spawnAutomation({ ...p, id });
    else overlays.toast(text().aiChat, text().aiErrors.ai_display_missing);
  };
  const service = new AiService({
    getConfig: () => store.get().ai,
    updateConfig: (config) => { store.update({ ai: config }); },
    credentials: new FileAiCredentialStore(store.dir, safeStorage),
    history: new FileAiHistoryStore(store.dir),
    changed: push,
    hasConsumers: () => consumers().length > 0,
    completed: (id, point) => {
      if (closed) return;
      if (point) showAt(point, 'omw');
      openAiWindow(false, id);
    },
    timerDue: (timer: VisionTimer) => showAt(timer, 'enemyvision'),
  });
  const capture = new ScreenCaptureService({
    sources: (options) => desktopCapturer.getSources(options),
    hidden: (fn) => overlays.withoutOverlays(fn),
  });
  const failure = (error: unknown): void => {
    if (!closed) overlays.toast(text().aiChat, text().aiErrors[aiErrorCode(error)]);
  };
  const notifyTimer = (minutes: number): void => {
    const t = text();
    overlays.toast(t.aiTimers, t.aiTimerNotice(minutes));
    if (!Notification.isSupported()) return;
    const notice = new Notification({ title: t.aiTimers, body: t.aiTimerNotice(minutes), silent: true });
    notifications.add(notice);
    notice.on('click', () => { if (!closed) openAiWindow(true, 'timers'); });
    notice.on('close', () => notifications.delete(notice));
    notice.show();
  };
  overlays.beforeLocalPing = (ping: SharedPing) => {
    if (closed) return;
    const display = screen.getAllDisplays().find((d) => d.id === ping.displayId);
    if (!display) return;
    const point: AiPoint = { ...ping, width: display.bounds.width, height: display.bounds.height };
    if (ping.id === 'danger') {
      void service.configure({ paused: true }).then(() => {
        overlays.toast(text().aiChat, text().aiPausedNotice);
      }).catch(failure);
    } else if (ping.id === 'needvision') {
      service.addTimer(point);
      notifyTimer(store.get().ai.visionMinutes);
    } else if (ping.id === 'missing') {
      return service.analyze(point, (signal) => capture.capture({ id: display.id, width: display.bounds.width,
        height: display.bounds.height, scale: display.scaleFactor }, signal)).catch(failure);
    }
  };
  registerAiIpc({
    service,
    trusted: (sender) => [aiWindow()].some((w) => {
      if (!w || w.webContents !== sender || sender.isDestroyed()) return false;
      try {
        const url = new URL(sender.getURL());
        const expected = new URL(pageUrl('chat'));
        return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname;
      } catch { return false; }
    }),
    openChat: (target) => { openAiWindow(true, target); },
    openSettings: () => { openSettingsWindow(); },
    locale,
  });
  const onResume = (): void => service.tick();
  const clock = setInterval(() => service.tick(), 1000);
  powerMonitor.on('resume', onResume);
  store.on('change', changedSettings);
  return {
    service,
    async close(): Promise<void> {
      closed = true;
      clearInterval(clock);
      powerMonitor.off('resume', onResume);
      store.off('change', changedSettings);
      overlays.beforeLocalPing = undefined;
      for (const notice of notifications) notice.close();
      notifications.clear();
      await service.close();
    },
  };
}
