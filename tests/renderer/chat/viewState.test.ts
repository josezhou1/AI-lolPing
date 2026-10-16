import { describe, expect, it } from 'vitest';
import { errorCode, validMinutes, conversationTitle, profileEditorReducer, syncTimerDraft, timerDraft,
  modelChoicesIdentity, modelChoicesReducer, conversationDraftReducer, type ModelChoicesState } from '../../../src/renderer/chat/viewState';
import { AI_ERRORS, type AiConversation, type ModelProfile } from '../../../src/shared/ai';
import { strings } from '../../../src/shared/i18n';

describe('chat view state', () => {
  it('extracts every known error through an Electron invoke prefix', () => {
    for (const code of AI_ERRORS) {
      expect(errorCode(new Error(`Error invoking remote method 'ai:test': Error: ${code}`))).toBe(code);
      expect(strings('en').aiErrors[code]).toBeTruthy();
      expect(strings('zh-CN').aiErrors[code]).toBeTruthy();
    }
  });

  it('uses a safe generic code for unknown errors without rendering raw service text', () => {
    expect(errorCode(new Error('secret provider response'))).toBe('ai_network_error');
    expect(errorCode('ai_auth_failed_suffix')).toBe('ai_network_error');
    expect(errorCode(null)).toBe('ai_network_error');
  });

  it('accepts only whole countdown durations within the supported range', () => {
    expect(validMinutes('1')).toBe(1);
    expect(validMinutes('60')).toBe(60);
    expect(validMinutes(' 5 ')).toBe(5);
    for (const value of ['', ' ', '0', '61', '-1', '1.5', 'NaN', 'Infinity', 'five']) {
      expect(validMinutes(value)).toBeNull();
    }
  });

  it('localizes initial titles while preserving user question titles', () => {
    const conversation: AiConversation = { id: 'c', title: 'Vision', profileId: 'p', messages: [], status: 'idle' };
    expect(conversationTitle(conversation, strings('zh-CN'))).toBe('屏幕解读');
    expect(conversationTitle({ ...conversation, title: 'AI' }, strings('en'))).toBe('Conversation');
    expect(conversationTitle({ ...conversation, title: 'Explain this graph' }, strings('zh-CN'))).toBe('Explain this graph');
  });

  it('updates a clean model editor when another window saves the profile', () => {
    const saved: ModelProfile = { id: 'p', name: 'Service', baseUrl: 'https://a.example/v1', model: 'old', supportsVision: false };
    const latest = { ...saved, model: 'new', baseUrl: 'https://b.example/v1' };
    const state = profileEditorReducer({ draft: saved, saved, conflict: false }, { type: 'sync', profile: latest, hasKey: false });
    expect(state.draft).toEqual(latest);
    expect(state.conflict).toBe(false);
    expect(profileEditorReducer(state, { type: 'edit', patch: { name: 'Renamed' } }).draft)
      .toEqual({ ...latest, name: 'Renamed' });
  });

  it('keeps dirty model edits and requires explicit conflict resolution after another window saves', () => {
    const saved: ModelProfile = { id: 'p', name: 'Service', baseUrl: 'https://a.example/v1', model: 'old', supportsVision: false };
    const draft = { ...saved, model: 'my edit' };
    const latest = { ...saved, model: 'other window' };
    const conflict = profileEditorReducer({ draft, saved, conflict: false }, { type: 'sync', profile: latest, hasKey: false });
    expect(conflict.draft).toEqual(draft);
    expect(conflict.saved).toEqual(latest);
    expect(conflict.conflict).toBe(true);
    expect(profileEditorReducer(conflict, { type: 'reload' })).toEqual({ draft: latest, saved: latest, conflict: false });
    expect(profileEditorReducer(conflict, { type: 'keep' })).toEqual({ draft, saved: latest, conflict: false });
    expect(profileEditorReducer({ draft: saved, saved, conflict: false }, { type: 'sync', profile: latest, hasKey: true }).conflict).toBe(true);
  });

  it('refreshes a timer input after adjustment while preserving unsaved input on ordinary clock ticks', () => {
    const original = { createdAt: 0, dueAt: 5 * 60000 };
    const draft = { ...timerDraft(original), minutes: '7' };
    expect(syncTimerDraft(draft, original)).toBe(draft);
    const adjusted = { createdAt: 4 * 60000, dueAt: 14 * 60000 };
    expect(syncTimerDraft(draft, adjusted).minutes).toBe('10');
    expect(timerDraft(adjusted).minutes).toBe('10');
  });

  it('clears returned models after a draft or externally saved endpoint changes', () => {
    const a: ModelProfile = { id: 'p', name: 'Service', baseUrl: 'https://a.example/v1', model: 'a-model', supportsVision: false };
    const b = { ...a, baseUrl: 'https://b.example/v1' };
    const identity = modelChoicesIdentity(a, a);
    const loaded: ModelChoicesState = { identity, generation: 'a-request', models: ['a-model'] };
    expect(modelChoicesReducer(loaded, { type: 'sync', identity })).toEqual(loaded);
    const localChange = modelChoicesReducer(loaded, { type: 'sync', identity: modelChoicesIdentity(b, a) });
    expect(localChange.models).toBeNull();
    const externalChange = modelChoicesReducer(loaded, { type: 'sync', identity: modelChoicesIdentity(a, b) });
    expect(externalChange.models).toBeNull();
    expect(externalChange.generation).toBeNull();
  });

  it('rejects late model lists after an endpoint change and return to the original endpoint', () => {
    const request = { identity: 'endpoint-a', generation: 'first' };
    let state: ModelChoicesState = { identity: 'endpoint-a', generation: null, models: null };
    state = modelChoicesReducer(state, { type: 'start', request });
    state = modelChoicesReducer(state, { type: 'sync', identity: 'endpoint-b' });
    state = modelChoicesReducer(state, { type: 'sync', identity: 'endpoint-a' });
    expect(modelChoicesReducer(state, { type: 'loaded', request, models: ['stale-a'] }).models).toBeNull();
  });

  it('only accepts the current model list request generation', () => {
    const first = { identity: 'endpoint-a', generation: 'first' };
    const second = { identity: 'endpoint-a', generation: 'second' };
    let state: ModelChoicesState = { identity: 'endpoint-a', generation: null, models: null };
    state = modelChoicesReducer(state, { type: 'start', request: first });
    state = modelChoicesReducer(state, { type: 'start', request: second });
    state = modelChoicesReducer(state, { type: 'loaded', request: second, models: ['current'] });
    expect(modelChoicesReducer(state, { type: 'loaded', request: first, models: ['old'] })).toBe(state);
    expect(state.models).toEqual(['current']);
  });

  it('retains independent unsent drafts across conversation switches and clears only the sent or deleted draft', () => {
    let drafts = conversationDraftReducer({}, { type: 'set', id: 'a', text: 'Unsent question A' });
    drafts = conversationDraftReducer(drafts, { type: 'set', id: 'b', text: 'Unsent question B' });
    expect(drafts.a).toBe('Unsent question A');
    expect(drafts.b).toBe('Unsent question B');
    drafts = conversationDraftReducer(drafts, { type: 'set', id: 'b', text: '' });
    expect(drafts.a).toBe('Unsent question A');
    expect(drafts.b).toBeUndefined();
    drafts = conversationDraftReducer(drafts, { type: 'remove', id: 'a' });
    expect(drafts).toEqual({});
  });
});
