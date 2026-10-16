import { AI_ERRORS, type AiConversation, type AiErrorCode, type ModelProfile, type VisionTimer } from '../../shared/ai';
import type { Strings } from '../../shared/i18n';

/** Electron invoke errors wrap the original error in a channel-specific prefix. */
export function errorCode(error: unknown): AiErrorCode {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return AI_ERRORS.find((code) => new RegExp(`\\b${code}\\b`).test(message)) ?? 'ai_network_error';
}

export function validMinutes(value: string): number | null {
  const minutes = Number(value);
  return value.trim() && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60 ? minutes : null;
}

export function conversationTitle(conversation: AiConversation, t: Strings): string {
  if (conversation.title === 'AI') return t.aiConversation;
  if (conversation.title === 'Vision') return t.aiScreenAnalysis;
  return conversation.title;
}

export interface ProfileEditorState { draft: ModelProfile; saved?: ModelProfile; conflict: boolean }
export type ProfileEditorAction = { type: 'sync'; profile?: ModelProfile; hasKey: boolean }
  | { type: 'edit'; patch: Partial<ModelProfile> } | { type: 'reload' } | { type: 'keep' }
  | { type: 'saved'; profile: ModelProfile };

const sameProfile = (a?: ModelProfile, b?: ModelProfile) => JSON.stringify(a) === JSON.stringify(b);

/** A second window can update a service while this editor remains mounted. */
export function profileEditorReducer(state: ProfileEditorState, action: ProfileEditorAction): ProfileEditorState {
  switch (action.type) {
    case 'edit': return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'keep': return { ...state, conflict: false };
    case 'reload': return state.saved ? { draft: state.saved, saved: state.saved, conflict: false } : state;
    case 'saved': return { draft: action.profile, saved: action.profile, conflict: false };
    case 'sync': {
      if (!action.profile || sameProfile(state.saved, action.profile)) return state;
      const dirty = !sameProfile(state.draft, state.saved) || action.hasKey;
      return { draft: dirty ? state.draft : action.profile, saved: action.profile, conflict: dirty };
    }
  }
}

export interface TimerDraft { createdAt: number; dueAt: number; minutes: string }
type TimerInterval = Pick<VisionTimer, 'createdAt' | 'dueAt'>;

export function timerDraft(timer: TimerInterval): TimerDraft {
  return { ...timer, minutes: String(Math.max(1, Math.min(60, Math.round((timer.dueAt - timer.createdAt) / 60000)))) };
}

/** Preserve local edits across ticks, but reflect a changed interval from either window. */
export function syncTimerDraft(state: TimerDraft, timer: TimerInterval): TimerDraft {
  return state.createdAt === timer.createdAt && state.dueAt === timer.dueAt ? state : timerDraft(timer);
}

export interface ModelListRequest { identity: string; generation: string }
export interface ModelChoicesState { identity: string; generation: string | null; models: string[] | null }
export type ModelChoicesAction = { type: 'sync'; identity: string }
  | { type: 'start'; request: ModelListRequest }
  | { type: 'loaded'; request: ModelListRequest; models: string[] };

export const modelChoicesIdentity = (draft: ModelProfile, saved?: ModelProfile): string =>
  JSON.stringify([draft.id, draft.baseUrl, saved?.id, saved?.baseUrl]);

export function modelChoicesReducer(state: ModelChoicesState, action: ModelChoicesAction): ModelChoicesState {
  switch (action.type) {
    case 'sync': return state.identity === action.identity ? state
      : { identity: action.identity, generation: null, models: null };
    case 'start': return { identity: action.request.identity, generation: action.request.generation, models: null };
    case 'loaded': return state.identity === action.request.identity && state.generation === action.request.generation
      ? { ...state, models: action.models } : state;
  }
}

export type ConversationDrafts = Record<string, string>;
export type ConversationDraftAction = { type: 'set'; id: string; text: string } | { type: 'remove'; id: string };

/** Composer text belongs to the conversation even while another pane is visible. */
export function conversationDraftReducer(state: ConversationDrafts, action: ConversationDraftAction): ConversationDrafts {
  if (action.type === 'set' && action.text) return { ...state, [action.id]: action.text };
  const remaining = { ...state };
  delete remaining[action.id];
  return remaining;
}
