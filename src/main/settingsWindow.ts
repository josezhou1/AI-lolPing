import type { BrowserWindow } from 'electron';
import { aiWindow, onAiWindowGone, openAiWindow } from './aiWindow';

/** Settings and chat share the same native window and renderer. */
export const settingsWindow = aiWindow;
export const onSettingsWindowGone = onAiWindowGone;

export function openSettingsWindow(section?: string): BrowserWindow {
  const target = section === 'ai' ? 'models' : section ? `settings-${section}` : 'settings';
  return openAiWindow(true, target);
}
