import type { AiConfig } from '../shared/ai';
import { hotkeyToAccelerator, type Hotkey } from '../shared/keys';
import { triggerVk, type Settings } from '../shared/settings';

export type AutomationFlag = 'recognitionEnabled' | 'timersEnabled';
interface Binding { key: Hotkey; flag: AutomationFlag; accelerator: string }
interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}
const sameKey = (a: Hotkey, b: Hotkey): boolean => a.mods === b.mods && a.vk === b.vk;

/** Owns only the two automation shortcuts, including rollback and temporary capture suspension. */
export class AiShortcuts {
  private bound: Binding[] = [];
  private suspended = false;
  private closed = false;

  constructor(private readonly registry: ShortcutRegistry, private readonly settings: () => Settings,
    private readonly toggle: (flag: AutomationFlag) => void) {}

  update(config: AiConfig, force = false): void {
    const current = this.settings();
    if (!force && JSON.stringify([config.recognitionHotkey, config.timersHotkey])
      === JSON.stringify([current.ai.recognitionHotkey, current.ai.timersHotkey])) return;
    const entries: Binding[] = [];
    for (const [key, flag] of [[config.recognitionHotkey, 'recognitionEnabled'],
      [config.timersHotkey, 'timersEnabled']] as const) {
      if (!key) continue;
      const accelerator = hotkeyToAccelerator(key);
      if (!accelerator || sameKey(key, current.toggleHotkey) || key.vk === triggerVk(current.trigger)
        || key.vk === triggerVk(current.emoteTrigger) || entries.some((entry) => sameKey(key, entry.key))) {
        throw new Error('ai_hotkey_conflict');
      }
      entries.push({ key, flag, accelerator });
    }
    if (this.closed) return;
    if (entries.length === this.bound.length
      && entries.every((entry, index) => entry.accelerator === this.bound[index]?.accelerator
        && entry.flag === this.bound[index]?.flag)) return;
    const previous = [...this.bound];
    this.release();
    try { this.bind(entries); if (this.suspended) this.release(); }
    catch (error) { this.release(); this.bind(previous); throw error; }
  }

  setCapturing(on: boolean): void {
    this.suspended = on;
    if (on) this.release();
    else this.update(this.settings().ai, true);
  }

  close(): void { this.closed = true; this.release(); }

  private release(): void {
    for (const entry of this.bound) this.registry.unregister(entry.accelerator);
    this.bound = [];
  }

  private bind(entries: Binding[]): void {
    for (const entry of entries) {
      if (!this.registry.register(entry.accelerator, () => {
        if (!this.closed && !this.suspended) this.toggle(entry.flag);
      })) throw new Error('ai_hotkey_conflict');
      this.bound.push(entry);
    }
  }
}
