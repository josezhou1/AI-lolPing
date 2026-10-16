import { describe, expect, it } from 'vitest';
import { AiShortcuts, type AutomationFlag } from '../../src/main/aiShortcuts';
import { normalizeAiConfig, type AiConfig } from '../../src/shared/ai';
import { normalizeSettings } from '../../src/shared/settings';

function setup(config: Partial<AiConfig> = {}, occupied: string[] = []) {
  let settings = normalizeSettings({ ai: config });
  const bindings = new Map<string, () => void>(occupied.map((key) => [key, () => undefined]));
  const toggles: AutomationFlag[] = [];
  const controller = new AiShortcuts({
    register: (key, callback) => {
      if (bindings.has(key)) return false;
      bindings.set(key, callback); return true;
    },
    unregister: (key) => { bindings.delete(key); },
  }, () => settings, (flag) => { toggles.push(flag); });
  const save = (patch: Partial<AiConfig>) => {
    const ai = normalizeAiConfig({ ...settings.ai, ...patch });
    controller.update(ai); settings = { ...settings, ai };
  };
  return { controller, bindings, toggles, save, settings: () => settings };
}
const recognitionHotkey = { mods: 3, vk: 73 };
const timersHotkey = { mods: 3, vk: 84 };

describe('AiShortcuts', () => {
  it('lets each saved global shortcut toggle its own disabled feature', () => {
    const f = setup({ recognitionHotkey, timersHotkey });
    f.controller.update(f.settings().ai, true);
    f.bindings.get('Control+Alt+I')?.();
    f.bindings.get('Control+Alt+T')?.();
    expect(f.toggles).toEqual(['recognitionEnabled', 'timersEnabled']);
    f.controller.close();
    expect(f.bindings.size).toBe(0);
  });

  it('moves an existing accelerator to the other feature without retaining its old callback', () => {
    const f = setup({ recognitionHotkey });
    f.controller.update(f.settings().ai, true);
    f.save({ recognitionHotkey: null, timersHotkey: recognitionHotkey });
    f.bindings.get('Control+Alt+I')?.();
    expect(f.toggles).toEqual(['timersEnabled']);
  });

  it('rejects collisions with another feature or the ping toggle and keeps the previous binding', () => {
    const f = setup({ recognitionHotkey });
    f.controller.update(f.settings().ai, true);
    expect(() => f.save({ timersHotkey: recognitionHotkey })).toThrow('ai_hotkey_conflict');
    expect(() => f.save({ timersHotkey: f.settings().toggleHotkey })).toThrow('ai_hotkey_conflict');
    expect([...f.bindings.keys()]).toEqual(['Control+Alt+I']);
  });

  it('rolls back an unavailable replacement without unregistering other apps shortcuts', () => {
    const f = setup({ recognitionHotkey }, ['Control+Alt+X']);
    f.controller.update(f.settings().ai, true);
    expect(() => f.save({ recognitionHotkey: { mods: 3, vk: 88 } })).toThrow('ai_hotkey_conflict');
    expect([...f.bindings.keys()].sort()).toEqual(['Control+Alt+I', 'Control+Alt+X']);
  });

  it('leaves manual switches usable when a saved shortcut is unavailable at launch', () => {
    const f = setup({ recognitionHotkey }, ['Control+Alt+I']);
    expect(() => f.controller.update(f.settings().ai, true)).toThrow('ai_hotkey_conflict');
    expect(() => f.save({ recognitionEnabled: true, visionMinutes: 10 })).not.toThrow();
    expect(f.settings().ai.recognitionEnabled).toBe(true);
    expect(f.settings().ai.visionMinutes).toBe(10);
  });

  it('releases shortcuts for recording, rejects occupied recordings and restores the saved binding', () => {
    const f = setup({ recognitionHotkey }, ['Control+Alt+X']);
    f.controller.update(f.settings().ai, true);
    f.controller.setCapturing(true);
    expect(f.bindings.has('Control+Alt+I')).toBe(false);
    expect(() => f.save({ recognitionHotkey: { mods: 3, vk: 88 } })).toThrow('ai_hotkey_conflict');
    f.save({ timersHotkey });
    expect(f.bindings.has('Control+Alt+T')).toBe(false);
    f.controller.setCapturing(false);
    expect([...f.bindings.keys()].sort()).toEqual(['Control+Alt+I', 'Control+Alt+T', 'Control+Alt+X']);
  });
});
