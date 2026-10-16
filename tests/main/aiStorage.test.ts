import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileAiCredentialStore, FileAiHistoryStore } from '../../src/main/aiStorage';
import { AI_LIMITS, normalizeAiHistory, type AiConversation } from '../../src/shared/ai';

describe('AI storage', () => {
  it('refuses plaintext fallback and persists encrypted credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lolping-ai-'));
    const encryption = { isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
      decryptString: (value: Buffer) => value.toString().split('').reverse().join('') };
    const store = new FileAiCredentialStore(dir, encryption);
    await store.set('p', 'secret-key');
    expect(readFileSync(join(dir, 'ai-credentials.json'), 'utf8')).not.toContain('secret-key');
    expect(new FileAiCredentialStore(dir, encryption).get('p')).toBe('secret-key');
    const insecure = new FileAiCredentialStore(dir, { ...encryption, getSelectedStorageBackend: () => 'basic_text' });
    await expect(insecure.set('p', 'new-secret')).rejects.toThrow('ai_secure_storage_unavailable');
    expect(insecure.get('p')).toBeUndefined();
    await store.delete('p');
    expect(store.ids()).toEqual([]);
  });

  it('serializes atomic history writes and restores only bounded text history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lolping-ai-'));
    const store = new FileAiHistoryStore(dir);
    await Promise.all([store.save([{ id: 'c', title: 'old', profileId: 'p', status: 'running', messages: [] }]),
      store.save([{ id: 'c', title: 'new', profileId: 'p', status: 'running', messages: [
        { id: 'm', role: 'user', content: 'hello' }] }])]);
    await store.flush();
    expect(new FileAiHistoryStore(dir).load()).toEqual([{ id: 'c', title: 'new', profileId: 'p', status: 'cancelled',
      messages: [{ id: 'm', role: 'user', content: 'hello' }] }]);
  });

  it('uses available native encryption when the Linux backend accessor throws on another OS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lolping-ai-'));
    const store = new FileAiCredentialStore(dir, { isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => { throw new Error('Linux only'); },
      encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() });
    await store.set('profile', 'key');
    expect(store.get('profile')).toBe('key');
  });

  it('bounds the complete serialized file including escaped source metadata and reloads newest history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lolping-ai-'));
    const sources = Array.from({ length: 5 }, (_, index) => ({ title: '\u0000'.repeat(200),
      url: `https://example.org/${index}/${'a'.repeat(2000)}` }));
    const conversations: AiConversation[] = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`,
      title: '\u0000'.repeat(100), profileId: 'p', status: 'completed', messages: Array.from({ length: 100 }, (_, message) =>
        ({ id: `m${message}`, role: 'assistant', content: 'text', sources })) }));
    conversations.push({ id: 'latest', title: 'Latest', profileId: 'p', status: 'completed', messages: [
      { id: 'latest-q', role: 'user', content: 'latest question' },
      { id: 'latest-a', role: 'assistant', content: 'latest answer' }] });
    const store = new FileAiHistoryStore(dir);
    await store.save(conversations);
    await store.flush();
    const file = readFileSync(join(dir, 'ai-history.json'));
    expect(file.byteLength).toBeLessThanOrEqual(AI_LIMITS.historyBytes);
    const restored = new FileAiHistoryStore(dir).load();
    expect(restored).toEqual(normalizeAiHistory(conversations));
    expect(restored.at(-1)?.messages.map((message) => message.content)).toEqual(['latest question', 'latest answer']);
    expect(restored.length).toBeGreaterThan(1);
  });

  it('returns a stable error code when the history directory cannot be created', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lolping-ai-'));
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'file');
    const store = new FileAiHistoryStore(blocked);
    await expect(store.save([])).rejects.toThrow(/^ai_storage_failed$/);
  });
});
