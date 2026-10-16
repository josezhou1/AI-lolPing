import { HOTKEY_PRIMARY_MODS, hotkeyToAccelerator, type Hotkey } from './keys';
import type { LanguagePref } from './i18n';
import type { Platform } from './platform';

export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  supportsVision: boolean;
}

export interface AiConfig {
  profiles: ModelProfile[];
  defaultChatProfileId: string | null;
  defaultVisionProfileId: string | null;
  paused: boolean;
  recognitionEnabled: boolean;
  timersEnabled: boolean;
  recognitionHotkey: Hotkey | null;
  timersHotkey: Hotkey | null;
  visionMinutes: number;
  searchEnabled: boolean;
}

export interface SearchSource { title: string; url: string }
export interface AiMessage { id: string; role: 'user' | 'assistant'; content: string; sources?: SearchSource[] }
export type AiStatus = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
export interface AiConversation {
  id: string;
  title: string;
  profileId: string;
  messages: AiMessage[];
  status: AiStatus;
  error?: AiErrorCode;
  /** Allows a retry after restart to ask for a new capture. No image is persisted. */
  kind?: 'vision';
}
export interface AiPoint { displayId: number; x: number; y: number; width: number; height: number }
export interface VisionTimer { id: string; displayId: number; x: number; y: number; createdAt: number; dueAt: number }
export interface AiSnapshot {
  locale?: { language: LanguagePref; locale: string; platform: Platform };
  config: AiConfig;
  conversations: AiConversation[];
  timers: VisionTimer[];
  credentialIds: string[];
  searchConfigured: boolean;
}

export const AI_ERRORS = [
  'ai_hotkey_conflict', 'ai_invalid_input', 'ai_profile_required', 'ai_vision_profile_required', 'ai_key_required', 'ai_paused',
  'ai_capacity', 'ai_busy', 'ai_not_found', 'ai_closed', 'ai_cancelled', 'ai_timeout', 'ai_network_error',
  'ai_auth_failed', 'ai_rate_limited', 'ai_provider_error', 'ai_invalid_response', 'ai_response_too_large',
  'ai_secure_storage_unavailable', 'ai_storage_failed', 'ai_capture_failed', 'ai_display_missing',
  'ai_search_failed', 'ai_recapture_required',
] as const;
export type AiErrorCode = typeof AI_ERRORS[number];
export const AI_LIMITS = { profiles: 20, conversations: 100, messages: 100, content: 32768,
  sources: 5, sourceUrlBytes: 2048, imageBytes: 20 * 1024 * 1024, historyBytes: 8 * 1024 * 1024 } as const;
const utf8Encoder = new TextEncoder();
const jsonBytes = (value: unknown): number => utf8Encoder.encode(JSON.stringify(value)).byteLength;
export const DEFAULT_AI_CONFIG: AiConfig = { profiles: [], defaultChatProfileId: null,
  defaultVisionProfileId: null, paused: false, recognitionEnabled: false, timersEnabled: false,
  recognitionHotkey: null, timersHotkey: null, visionMinutes: 5, searchEnabled: false };

export const isAiRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isAiId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const isAiText = (value: unknown, max: number = AI_LIMITS.content): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('data:image/');
export const isAiErrorCode = (value: unknown): value is AiErrorCode =>
  typeof value === 'string' && (AI_ERRORS as readonly string[]).includes(value);
export const aiErrorCode = (error: unknown): AiErrorCode =>
  error instanceof Error && isAiErrorCode(error.message) ? error.message : 'ai_network_error';

/** API endpoints cannot carry credentials, fragments or query keys. */
export function validAiUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === 'https:') return true;
    const host = url.hostname.toLowerCase();
    const octets = host.split('.').map(Number);
    const localIp = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 169 && octets[1] === 254));
    return url.protocol === 'http:' && (host === 'localhost' || host === '[::1]' || localIp
      || /^\[(fc|fd|fe80:)/.test(host));
  } catch { return false; }
}

export function validExternalAiUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > AI_LIMITS.sourceUrlBytes
    || utf8Encoder.encode(value).byteLength > AI_LIMITS.sourceUrlBytes) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

export function localAiUrl(value: string): boolean {
  if (!validAiUrl(value)) return false;
  const url = new URL(value);
  url.protocol = 'http:';
  return validAiUrl(url.toString());
}

export function validateAiProfile(raw: unknown): ModelProfile | null {
  if (!isAiRecord(raw) || !isAiId(raw.id) || !isAiText(raw.name, 80) || !validAiUrl(raw.baseUrl)
    || !isAiText(raw.model, 200) || typeof raw.supportsVision !== 'boolean') return null;
  return { id: raw.id, name: raw.name.trim(), baseUrl: raw.baseUrl.replace(/\/+$/, ''),
    model: raw.model.trim(), supportsVision: raw.supportsVision };
}

export const aiMinutes = (value: unknown, fallback = 5): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(60, Math.max(1, Math.round(value))) : fallback;

export function normalizeFeatureHotkey(raw: unknown): Hotkey | null {
  if (!isAiRecord(raw) || typeof raw.mods !== 'number' || !Number.isInteger(raw.mods)
    || raw.mods < 1 || raw.mods > 15 || !(raw.mods & HOTKEY_PRIMARY_MODS)
    || typeof raw.vk !== 'number' || !Number.isInteger(raw.vk) || raw.vk < 1 || raw.vk > 254) return null;
  const key = { mods: raw.mods, vk: raw.vk };
  return hotkeyToAccelerator(key) ? key : null;
}

export function normalizeAiConfig(raw: unknown): AiConfig {
  const value = isAiRecord(raw) ? raw : {};
  const profiles: ModelProfile[] = [];
  if (Array.isArray(value.profiles)) for (const item of value.profiles.slice(0, 100)) {
    const profile = validateAiProfile(item);
    if (profile && profiles.length < AI_LIMITS.profiles && !profiles.some((p) => p.id === profile.id)) profiles.push(profile);
  }
  return { profiles,
    defaultChatProfileId: profiles.some((p) => p.id === value.defaultChatProfileId) ? String(value.defaultChatProfileId) : null,
    defaultVisionProfileId: profiles.some((p) => p.id === value.defaultVisionProfileId && p.supportsVision)
      ? String(value.defaultVisionProfileId) : null,
    recognitionEnabled: value.recognitionEnabled === true, timersEnabled: value.timersEnabled === true,
    recognitionHotkey: normalizeFeatureHotkey(value.recognitionHotkey),
    timersHotkey: normalizeFeatureHotkey(value.timersHotkey),
    paused: value.paused === true, visionMinutes: aiMinutes(value.visionMinutes), searchEnabled: value.searchEnabled === true };
}

export function validateAiPoint(raw: unknown): raw is AiPoint {
  if (!isAiRecord(raw)) return false;
  return typeof raw.displayId === 'number' && Number.isSafeInteger(raw.displayId)
    && ['x', 'y', 'width', 'height'].every((key) => typeof raw[key] === 'number' && Number.isFinite(raw[key])
      && Math.abs(raw[key] as number) <= 100000)
    && (raw.width as number) > 0 && (raw.height as number) > 0;
}

export function normalizeSearchSources(raw: unknown): SearchSource[] {
  if (!Array.isArray(raw)) return [];
  const sources: SearchSource[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!isAiRecord(item) || !validExternalAiUrl(item.url) || typeof item.title !== 'string') continue;
    if (!sources.some((source) => source.url === item.url)) sources.push({ title: item.title.slice(0, 200), url: item.url });
    if (sources.length === AI_LIMITS.sources) break;
  }
  return sources;
}

/** Keep the newest history within its complete serialized UTF-8 budget, returned in chronological order. */
export function normalizeAiHistory(raw: unknown, interrupted = true): AiConversation[] {
  if (!Array.isArray(raw)) return [];
  const out: AiConversation[] = [];
  let bytes = 2; // The enclosing JSON array, plus each entry and comma below.
  for (const item of raw.slice(-AI_LIMITS.conversations).reverse()) {
    if (!isAiRecord(item) || !isAiId(item.id) || !isAiId(item.profileId) || out.some((c) => c.id === item.id)) continue;
    const messages: AiMessage[] = [];
    const statuses: readonly unknown[] = ['idle', 'queued', 'running', 'completed', 'cancelled', 'error'];
    const status: AiStatus = statuses.includes(item.status) ? item.status as AiStatus : 'idle';
    const conversation: AiConversation = { id: item.id, title: typeof item.title === 'string' && !item.title.includes('data:image/')
      ? item.title.slice(0, 100) : 'AI', profileId: item.profileId, messages,
      status: interrupted && (status === 'running' || status === 'queued') ? 'cancelled' : status,
      ...(isAiErrorCode(item.error) ? { error: item.error } : {}), ...(item.kind === 'vision' ? { kind: 'vision' } : {}) };
    let conversationBytes = jsonBytes(conversation) + (out.length ? 1 : 0);
    if (bytes + conversationBytes > AI_LIMITS.historyBytes) break;
    let full = false;
    if (Array.isArray(item.messages)) for (const message of item.messages.slice(-AI_LIMITS.messages).reverse()) {
      if (!isAiRecord(message) || !isAiId(message.id) || !isAiText(message.content)
        || (message.role !== 'user' && message.role !== 'assistant')) continue;
      const sources = normalizeSearchSources(message.sources);
      const normalized: AiMessage = { id: message.id, role: message.role, content: message.content,
        ...(sources.length ? { sources } : {}) };
      const messageBytes = jsonBytes(normalized) + (messages.length ? 1 : 0);
      if (bytes + conversationBytes + messageBytes > AI_LIMITS.historyBytes) { full = true; break; }
      conversationBytes += messageBytes;
      messages.push(normalized);
    }
    messages.reverse();
    out.push(conversation);
    bytes += conversationBytes;
    if (full) break;
  }
  return out.reverse();
}

export interface AiApi {
  snapshot(): Promise<AiSnapshot>;
  subscribe(callback: (snapshot: AiSnapshot) => void): () => void;
  saveProfile(profile: ModelProfile, key?: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  configure(patch: Partial<AiConfig>): Promise<void>;
  setSearchKey(key: string): Promise<void>;
  models(profileId: string): Promise<string[]>;
  test(profileId: string): Promise<void>;
  create(profileId?: string): Promise<string>;
  setProfile(id: string, profileId: string): Promise<void>;
  send(id: string, text: string): Promise<void>;
  retry(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  adjustTimer(id: string, minutes: number): Promise<void>;
  cancelTimer(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openSettings(): Promise<void>;
  copy(text: string): Promise<void>;
  openChat(target?: string): Promise<void>;
  onNavigate(callback: (target: string) => void): () => void;
  getLocale(): Promise<{ language: LanguagePref; locale: string; platform: Platform }>;
}
