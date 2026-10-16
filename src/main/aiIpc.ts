import { clipboard, ipcMain, shell, type WebContents } from 'electron';
import { isAiId, isAiRecord, isAiText, validateAiProfile, validExternalAiUrl, type AiConfig } from '../shared/ai';
import { AI_CH } from '../shared/aiChannels';
import type { AiService } from './aiService';

interface AiIpcDeps {
  service: AiService;
  trusted(sender: WebContents): boolean;
  openChat(target?: string): void;
  openSettings(): void;
  locale(): { language: import('../shared/i18n').LanguagePref; locale: string; platform: import('../shared/platform').Platform };
}

const invalid = (): never => { throw new Error('ai_invalid_input'); };
const id = (raw: unknown): string => isAiId(raw) ? raw : invalid();

/** AI commands are available only to the app's own main-frame settings and chat pages. */
export function registerAiIpc(d: AiIpcDeps): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!d.trusted(event.sender) || event.senderFrame !== event.sender.mainFrame) return invalid();
      return fn(...args);
    });
  };
  handle(AI_CH.snapshot, () => ({ ...d.service.snapshot(), locale: d.locale() }));
  handle(AI_CH.saveProfile, (raw, key) => {
    const p = validateAiProfile(raw);
    if (!p || (key !== undefined && (typeof key !== 'string' || key.length > 8192))) return invalid();
    return d.service.saveProfile(p, key as string | undefined);
  });
  handle(AI_CH.deleteProfile, (raw) => d.service.deleteProfile(id(raw)));
  handle(AI_CH.configure, (raw) => {
    if (!isAiRecord(raw)) return invalid();
    return d.service.configure(raw as Partial<AiConfig>);
  });
  handle(AI_CH.setSearchKey, (key) => {
    if (typeof key !== 'string' || key.length > 8192) return invalid();
    return d.service.setSearchKey(key);
  });
  handle(AI_CH.models, (raw) => d.service.models(id(raw)));
  handle(AI_CH.test, (raw) => d.service.test(id(raw)));
  handle(AI_CH.create, (raw) => d.service.create(raw === undefined ? undefined : id(raw)));
  handle(AI_CH.setProfile, (raw, profile) => d.service.setProfile(id(raw), id(profile)));
  handle(AI_CH.send, (raw, text) => {
    if (!isAiText(text)) return invalid();
    return d.service.send(id(raw), text);
  });
  handle(AI_CH.retry, (raw) => d.service.retry(id(raw)));
  handle(AI_CH.stop, (raw) => d.service.stop(id(raw)));
  handle(AI_CH.remove, (raw) => d.service.remove(id(raw)));
  handle(AI_CH.adjustTimer, (raw, minutes) => {
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) return invalid();
    return d.service.adjustTimer(id(raw), minutes);
  });
  handle(AI_CH.cancelTimer, (raw) => d.service.cancelTimer(id(raw)));
  handle(AI_CH.openExternal, (raw) => {
    if (!validExternalAiUrl(raw)) return invalid();
    return shell.openExternal(raw);
  });
  handle(AI_CH.copy, (text) => {
    if (typeof text !== 'string' || text.length > 100000) return invalid();
    clipboard.writeText(text);
  });
  handle(AI_CH.openSettings, () => d.openSettings());
  handle(AI_CH.openChat, (target) => {
    if (target !== undefined && !isAiId(target)) return invalid();
    d.openChat(target as string | undefined);
  });
  handle(AI_CH.getLocale, () => d.locale());
}
