import type { AiApi, AiSnapshot } from '../shared/ai';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { SettingsApi } from '../shared/ipc';
import { SETTINGS_CH } from '../shared/settingsChannels';

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: SettingsApi = {
  // Inlined rather than imported: a sandboxed preload can't require a shared chunk.
  platform: process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'win',
  getSettings: () => ipcRenderer.invoke(SETTINGS_CH.get),
  setSettings: (patch) => ipcRenderer.invoke(SETTINGS_CH.set, patch),
  onSettings: (cb) => subscribe(SETTINGS_CH.changed, cb),
  getStatus: () => ipcRenderer.invoke(SETTINGS_CH.status),
  onStatus: (cb) => subscribe(SETTINGS_CH.statusChanged, cb),
  setEnabled: (on) => ipcRenderer.invoke(SETTINGS_CH.setEnabled, on),
  previewPing: (id) => ipcRenderer.invoke(SETTINGS_CH.preview, id),
  previewEmote: (ref) => ipcRenderer.invoke(SETTINGS_CH.previewEmote, ref),
  importEmote: (file) => ipcRenderer.invoke(SETTINGS_CH.emoteImport, file),
  removeEmote: (id) => ipcRenderer.invoke(SETTINGS_CH.emoteRemove, id),
  setEmoteSound: (id, sound) => ipcRenderer.invoke(SETTINGS_CH.emoteSound, id, sound),
  getAbout: () => ipcRenderer.invoke(SETTINGS_CH.about),
  openSettingsFolder: () => ipcRenderer.invoke(SETTINGS_CH.openFolder),
  openProjectPage: () => ipcRenderer.invoke(SETTINGS_CH.openProject),
  retryHelper: () => ipcRenderer.invoke(SETTINGS_CH.retryHelper),
  setCapturing: (on) => ipcRenderer.invoke(SETTINGS_CH.capture, on),
  openAccessibility: () => ipcRenderer.invoke(SETTINGS_CH.openAccessibility),
  getRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomGet),
  onRoom: (cb) => subscribe(SETTINGS_CH.roomChanged, cb),
  createRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomCreate),
  joinRoom: (text) => ipcRenderer.invoke(SETTINGS_CH.roomJoin, text),
  leaveRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomLeave),
  muteMember: (peer, on) => ipcRenderer.invoke(SETTINGS_CH.roomMute, peer, on),
  clipboardRoomCode: () => ipcRenderer.invoke(SETTINGS_CH.roomClipboard),
  copyRoomCode: () => ipcRenderer.invoke(SETTINGS_CH.roomCopy),
  retryInternet: () => ipcRenderer.invoke(SETTINGS_CH.roomRetryInternet),
  onShowSection: (cb) => subscribe(SETTINGS_CH.showSection, cb),
  getUpdate: () => ipcRenderer.invoke(SETTINGS_CH.updateGet),
  onUpdate: (cb) => subscribe(SETTINGS_CH.updateState, cb),
  checkForUpdates: () => ipcRenderer.invoke(SETTINGS_CH.updateCheck),
  startUpdate: () => ipcRenderer.invoke(SETTINGS_CH.updateStart),
  openReleasePage: () => ipcRenderer.invoke(SETTINGS_CH.updateOpenRelease),
};

contextBridge.exposeInMainWorld('settingsApi', api);



function aiListen<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Literal channel names keep each sandboxed preload self-contained (no shared require chunk).
const aiApi: AiApi = {
  snapshot: () => ipcRenderer.invoke('ai:snapshot'),
  subscribe: (cb) => aiListen<AiSnapshot>('ai:changed', cb),
  saveProfile: (p, key) => ipcRenderer.invoke('ai:saveProfile', p, key),
  deleteProfile: (id) => ipcRenderer.invoke('ai:deleteProfile', id),
  configure: (p) => ipcRenderer.invoke('ai:configure', p),
  setSearchKey: (key) => ipcRenderer.invoke('ai:setSearchKey', key),
  models: (id) => ipcRenderer.invoke('ai:models', id),
  test: (id) => ipcRenderer.invoke('ai:test', id),
  create: (profile) => ipcRenderer.invoke('ai:create', profile),
  setProfile: (id, profile) => ipcRenderer.invoke('ai:setProfile', id, profile),
  send: (id, text) => ipcRenderer.invoke('ai:send', id, text),
  retry: (id) => ipcRenderer.invoke('ai:retry', id),
  stop: (id) => ipcRenderer.invoke('ai:stop', id),
  remove: (id) => ipcRenderer.invoke('ai:remove', id),
  adjustTimer: (id, minutes) => ipcRenderer.invoke('ai:adjustTimer', id, minutes),
  cancelTimer: (id) => ipcRenderer.invoke('ai:cancelTimer', id),
  openExternal: (url) => ipcRenderer.invoke('ai:openExternal', url),
  openSettings: () => ipcRenderer.invoke('ai:openSettings'),
  copy: (text) => ipcRenderer.invoke('ai:copy', text),
  openChat: (target) => ipcRenderer.invoke('ai:openChat', target),
  onNavigate: (cb) => aiListen<string>('ai:navigate', cb),
  getLocale: () => ipcRenderer.invoke('ai:getLocale'),
};

contextBridge.exposeInMainWorld('aiApi', aiApi);
