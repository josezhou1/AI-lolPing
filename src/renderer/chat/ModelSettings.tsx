import { Badge, Button, Switch } from '@fluentui/react-components';
import { useEffect, useId, useReducer, useState } from 'react';
import { AI_LIMITS, validateAiProfile, type AiConfig, type AiSnapshot, type ModelProfile } from '../../shared/ai';
import type { Strings } from '../../shared/i18n';
import { aiApi, errorCode, validMinutes } from './api';
import { useAiState } from './useAiState';
import { profileEditorReducer, modelChoicesIdentity, modelChoicesReducer, type ProfileEditorState } from './viewState';
import './model-settings.css';

export function AiSettingsSection({ t }: { t: Strings }) {
  const { snapshot, error } = useAiState();
  return snapshot ? <ModelSettings snapshot={snapshot} t={t} />
    : <p role={error ? 'alert' : 'status'}>{error ? t.aiErrors[error] : t.aiLoading}</p>;
}

export function ModelSettings({ snapshot, t }: { snapshot: AiSnapshot; t: Strings }) {
  const { config } = snapshot;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(String(config.visionMinutes));
  const [searchKey, setSearchKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(false);
  useEffect(() => setMinutes(String(config.visionMinutes)), [config.visionMinutes]);
  const run = async (operation: () => Promise<void>) => {
    setError(null); setNotice(false); setBusy(true);
    try { await operation(); setNotice(true); }
    catch (reason) { setError(t.aiErrors[errorCode(reason)]); }
    finally { setBusy(false); }
  };
  const configure = (patch: Partial<AiConfig>) => void run(() => aiApi.configure(patch));
  return <div className="ai-settings">
    <div className="ai-toolbar"><Button appearance="primary" onClick={() => void run(() => aiApi.openChat())}>{t.aiChat}</Button>
      <Switch checked={config.paused} label={t.aiPaused} disabled={busy}
        onChange={(_, data) => configure({ paused: data.checked })} /></div>
    <p className="ai-help">{t.aiPausedHelp}</p>
    {error && <p className="ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-success" role="status">{t.aiSaved}</p>}
    <section className="ai-card"><h3>{t.aiDefaults}</h3>
      <div className="ai-fields">
        <label>{t.aiDefaultChat}<select value={config.defaultChatProfileId ?? ''} disabled={busy}
          onChange={(event) => configure({ defaultChatProfileId: event.target.value || null })}>
          <option value="">{t.aiNone}</option>{config.profiles.map((profile) =>
            <option value={profile.id} key={profile.id}>{profile.name} · {profile.model}</option>)}
        </select></label>
        <label>{t.aiDefaultVision}<select value={config.defaultVisionProfileId ?? ''} disabled={busy}
          onChange={(event) => configure({ defaultVisionProfileId: event.target.value || null })}>
          <option value="">{t.aiNone}</option>{config.profiles.filter((profile) => profile.supportsVision).map((profile) =>
            <option value={profile.id} key={profile.id}>{profile.name} · {profile.model}</option>)}
        </select></label>
      </div>
      <form className="ai-toolbar" onSubmit={(event) => { event.preventDefault(); const value = validMinutes(minutes);
        if (value === null) setError(t.aiMinuteValidation); else configure({ visionMinutes: value }); }}>
        <label className="ai-minute-field">{t.aiDefaultMinutes}<input type="number" min="1" max="60" step="1"
          required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>{t.aiSave}</Button>
      </form>
      <p className="ai-help">{t.aiScreenHelp}</p>
    </section>
    {config.profiles.map((profile) => <ProfileEditor key={profile.id} profile={profile}
      configured={snapshot.credentialIds.includes(profile.id)} t={t} />)}
    {adding && <ProfileEditor key="new" t={t} onClose={() => setAdding(false)} />}
    {!adding && <Button disabled={config.profiles.length >= AI_LIMITS.profiles} onClick={() => setAdding(true)}>{t.aiAddProfile}</Button>}
    <section className="ai-card">
      <Switch label={t.aiSearch} checked={config.searchEnabled} disabled={busy}
        onChange={(_, data) => configure({ searchEnabled: data.checked })} />
      <p className="ai-help">{t.aiSearchHelp}</p>
      <Badge appearance="tint">{snapshot.searchConfigured ? t.aiKeyConfigured : t.aiKeyMissing}</Badge>
      <form className="ai-toolbar" onSubmit={(event) => { event.preventDefault();
        if (searchKey.trim()) void run(async () => { await aiApi.setSearchKey(searchKey); setSearchKey(''); }); }}>
        <label className="ai-key-field">{t.aiSearchKey}<input type="password" autoComplete="new-password"
          value={searchKey} onChange={(event) => setSearchKey(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !searchKey.trim()}>{t.aiSave}</Button>
        <Button disabled={busy || !snapshot.searchConfigured} onClick={() => void run(async () => {
          await aiApi.setSearchKey(''); setSearchKey('');
        })}>{t.aiClearKey}</Button>
      </form>
    </section>
  </div>;
}

function ProfileEditor({ profile, configured = false, t, onClose }: {
  profile?: ModelProfile; configured?: boolean; t: Strings; onClose?: () => void;
}) {
  const [editor, dispatch] = useReducer(profileEditorReducer, undefined, (): ProfileEditorState => ({
    draft: profile ?? { id: crypto.randomUUID(), name: '', baseUrl: '', model: '', supportsVision: false },
    saved: profile, conflict: false,
  }));
  const { draft, conflict } = editor;
  const [key, setKey] = useState('');
  const modelIdentity = modelChoicesIdentity(draft, profile);
  const [modelChoices, updateModels] = useReducer(modelChoicesReducer, {
    identity: modelIdentity, generation: null, models: null,
  });
  const models = modelChoices.identity === modelIdentity ? modelChoices.models : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listId = useId();
  useEffect(() => { dispatch({ type: 'sync', profile, hasKey: !!key }); }, [profile, key]);
  useEffect(() => { updateModels({ type: 'sync', identity: modelIdentity }); }, [modelIdentity]);
  const dirty = !profile || JSON.stringify(draft) !== JSON.stringify(profile) || !!key;
  const run = async (operation: () => Promise<void>, success?: string) => {
    setError(null); setNotice(null); setBusy(true);
    try { await operation(); if (success) setNotice(success); }
    catch (reason) { setError(t.aiErrors[errorCode(reason)]); }
    finally { setBusy(false); }
  };
  const edit = (patch: Partial<ModelProfile>) => {
    updateModels({ type: 'sync', identity: modelChoicesIdentity({ ...draft, ...patch }, profile) });
    dispatch({ type: 'edit', patch }); setNotice(null);
  };
  const listModels = () => {
    const request = { identity: modelIdentity, generation: crypto.randomUUID() };
    updateModels({ type: 'start', request });
    void run(async () => {
      const result = await aiApi.models(draft.id);
      updateModels({ type: 'loaded', request, models: result });
    });
  };
  return <section className="ai-card">
    <div className="ai-toolbar"><h3>{profile?.name || t.aiAddProfile}</h3>
      <Badge appearance="tint">{configured ? t.aiKeyConfigured : t.aiKeyMissing}</Badge></div>
    <form onSubmit={(event) => { event.preventDefault();
      if (conflict) return;
      const valid = validateAiProfile(draft);
      if (!valid) { setError(t.aiErrors.ai_invalid_input); return; }
      void run(async () => {
        await aiApi.saveProfile(valid, key.trim() ? key : undefined);
        dispatch({ type: 'saved', profile: valid }); setKey(''); onClose?.();
      }, t.aiSaved);
    }}>
      <fieldset disabled={busy} className="ai-fieldset">
        <div className="ai-fields">
          <label>{t.aiProfileName}<input required maxLength={80} value={draft.name} onChange={(event) => edit({ name: event.target.value })} /></label>
          <label>{t.aiBaseUrl}<input required type="url" maxLength={2048} value={draft.baseUrl} onChange={(event) => edit({ baseUrl: event.target.value })} /></label>
        </div>
        <p className="ai-help">{t.aiBaseUrlHelp}</p>
        <label>{t.aiModel}<input required maxLength={200} list={listId} value={draft.model} onChange={(event) => edit({ model: event.target.value })} /></label>
        <datalist id={listId}>{models?.map((model) => <option key={model} value={model} />)}</datalist>
        {!!models?.length && <label>{t.aiSelectModel}<select value={models.includes(draft.model) ? draft.model : ''}
          onChange={(event) => { if (event.target.value) edit({ model: event.target.value }); }}>
          <option value="">{t.aiSelectModel}</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select></label>}
        <Switch label={t.aiVision} checked={draft.supportsVision} onChange={(_, data) => edit({ supportsVision: data.checked })} />
        <label>{t.aiKey}<input type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} /></label>
        <p className="ai-help">{t.aiKeyHelp}</p>
        <div className="ai-toolbar">
          <Button appearance="primary" type="submit" disabled={conflict}>{t.aiSave}</Button>
          <Button disabled={!profile || dirty} onClick={listModels}>{t.aiListModels}</Button>
          <Button disabled={!profile || dirty} onClick={() => void run(() => aiApi.test(draft.id), t.aiTestSuccess)}>{t.aiTest}</Button>
          {profile && <Button disabled={!configured} onClick={() => void run(async () => {
            await aiApi.saveProfile(profile, ''); setKey('');
          }, t.aiSaved)}>{t.aiClearKey}</Button>}
          {profile && <Button onClick={() => deleting ? void run(() => aiApi.deleteProfile(profile.id)) : setDeleting(true)}>{deleting ? t.aiConfirmDelete : t.aiDelete}</Button>}
          {(deleting || onClose) && <Button onClick={() => { setDeleting(false); onClose?.(); }}>{t.aiCancel}</Button>}
        </div>
      </fieldset>
    </form>
    {conflict && <div role="alert" className="ai-error"><p>{t.aiProfileConflict}</p><div className="ai-toolbar">
      <Button onClick={() => { dispatch({ type: 'reload' }); setKey(''); }}>{t.aiReloadProfile}</Button>
      <Button onClick={() => dispatch({ type: 'keep' })}>{t.aiKeepEdits}</Button>
    </div></div>}
    {dirty && <p className="ai-help">{t.aiSaveFirst}</p>}
    {models?.length === 0 && <p className="ai-help">{t.aiNoModels}</p>}
    {busy && <p role="status">{t.aiWorking}</p>}
    {notice && <p className="ai-success" role="status">{notice}</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
  </section>;
}
