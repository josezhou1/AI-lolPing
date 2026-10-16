import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AI_LIMITS, isAiId, isAiRecord, normalizeAiHistory, type AiConversation } from '../shared/ai';
import { renameWithRetry } from './settingsStore';

export interface AiCredentialStore {
  get(id: string): string | undefined;
  ids(): string[];
  set(id: string, key: string): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface AiHistoryStore {
  load(): AiConversation[];
  save(conversations: AiConversation[]): Promise<void>;
  flush(): Promise<void>;
}
/** Electron safeStorage is supplied by the main process; tests and this module need no Electron runtime. */
export interface AiEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

async function atomicWrite(dir: string, file: string, data: string): Promise<void> {
  const temporary = `${file}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
    await renameWithRetry(temporary, file);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error('ai_storage_failed');
  }
}

export class FileAiCredentialStore implements AiCredentialStore {
  private encrypted: Record<string, string> = {};
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(private readonly dir: string, private readonly encryption: AiEncryption) {
    this.file = join(dir, 'ai-credentials.json');
    try {
      if (existsSync(this.file) && statSync(this.file).size <= 256 * 1024) {
        const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
        if (isAiRecord(raw)) for (const [id, value] of Object.entries(raw).slice(0, 100)) {
          if (isAiId(id) && typeof value === 'string' && value.length <= 16384
            && /^[a-zA-Z0-9+/]+=*$/.test(value)) this.encrypted[id] = value;
        }
      }
    } catch { this.encrypted = {}; }
  }

  private available(): boolean {
    try { if (!this.encryption.isEncryptionAvailable()) return false; }
    catch { return false; }
    try { return this.encryption.getSelectedStorageBackend?.() !== 'basic_text'; }
    catch { return true; } // Electron exposes this Linux-only accessor on other platforms as well.
  }

  get(id: string): string | undefined {
    if (!isAiId(id) || !this.available() || !Object.hasOwn(this.encrypted, id)) return undefined;
    try { return this.encryption.decryptString(Buffer.from(this.encrypted[id], 'base64')); }
    catch { return undefined; }
  }

  ids(): string[] { return Object.keys(this.encrypted).filter((id) => this.get(id) !== undefined); }

  set(id: string, key: string): Promise<void> {
    if (!isAiId(id) || typeof key !== 'string' || key.length > 4096 || !key.trim() || /[\r\n]/.test(key)) {
      return Promise.reject(new Error('ai_invalid_input'));
    }
    if (!this.available()) return Promise.reject(new Error('ai_secure_storage_unavailable'));
    return this.mutate((current) => {
      if (!this.available()) throw new Error('ai_secure_storage_unavailable');
      try { return { ...current, [id]: this.encryption.encryptString(key.trim()).toString('base64') }; }
      catch { throw new Error('ai_secure_storage_unavailable'); }
    });
  }

  delete(id: string): Promise<void> {
    if (!isAiId(id)) return Promise.reject(new Error('ai_invalid_input'));
    return this.mutate((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  private mutate(change: (current: Record<string, string>) => Record<string, string>): Promise<void> {
    const operation = this.writing.catch(() => undefined).then(async () => {
      const next = change(this.encrypted);
      await atomicWrite(this.dir, this.file, JSON.stringify(next));
      this.encrypted = next;
    });
    this.writing = operation;
    return operation;
  }
}

export class FileAiHistoryStore implements AiHistoryStore {
  private readonly file: string;
  private writing: Promise<void> | null = null;
  private pending: string | null = null;
  constructor(private readonly dir: string) { this.file = join(dir, 'ai-history.json'); }

  load(): AiConversation[] {
    try {
      if (!existsSync(this.file) || statSync(this.file).size > AI_LIMITS.historyBytes) return [];
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return normalizeAiHistory(raw);
    } catch { return []; }
  }

  save(conversations: AiConversation[]): Promise<void> {
    this.pending = JSON.stringify(normalizeAiHistory(conversations, false));
    if (!this.writing) {
      this.writing = Promise.resolve().then(async () => {
        while (this.pending !== null) {
          const data = this.pending;
          this.pending = null;
          await atomicWrite(this.dir, this.file, data);
        }
      }).finally(() => { this.writing = null; });
    }
    return this.writing;
  }

  flush(): Promise<void> { return this.writing ?? Promise.resolve(); }
}
