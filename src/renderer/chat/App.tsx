import { Badge, Button, FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { Add20Regular, BrainCircuitRegular, Chat20Regular, Delete20Regular, Settings20Regular, Timer20Regular } from '@fluentui/react-icons';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AI_LIMITS, type AiConversation, type AiSnapshot, type VisionTimer } from '../../shared/ai';
import { resolveLang, strings, type Strings } from '../../shared/i18n';
import { aiApi, errorCode, validMinutes } from './api';
import { ModelSettings } from './ModelSettings';
import { useAiState } from './useAiState';
import { App as SettingsApp } from '../settings/App';
import { conversationTitle, syncTimerDraft, timerDraft, conversationDraftReducer } from './viewState';

export function App() {
  const { snapshot, error, setError } = useAiState();
  const [t, setText] = useState(() => strings(resolveLang('auto', navigator.language)));
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [active, setActive] = useState(() => location.hash.slice(1));
  const [drafts, updateDraft] = useReducer(conversationDraftReducer, {});
  const initialized = useRef(false);
  const receivedLocale = useRef(false);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setDark(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    let alive = true;
    void aiApi.getLocale().then((locale) => {
      if (alive && !receivedLocale.current) setText(strings(resolveLang(locale.language, locale.locale), locale.platform));
    }).catch((reason: unknown) => { if (alive) setError(errorCode(reason)); });
    return () => { alive = false; };
  }, [setError]);
  const locale = snapshot?.locale;
  useEffect(() => {
    if (!locale) return;
    receivedLocale.current = true;
    setText(strings(resolveLang(locale.language, locale.locale), locale.platform));
  }, [locale?.language, locale?.locale, locale?.platform]);
  useEffect(() => aiApi.onNavigate((target) => {
    setActive((current) => target === 'chat'
      ? latest.current?.conversations.some((item) => item.id === current) ? current
        : latest.current?.conversations.at(-1)?.id ?? ''
      : target);
    setError(null);
  }), [setError]);
  useEffect(() => {
    if (!snapshot || initialized.current) return;
    initialized.current = true;
    if (!active || active === 'chat') setActive(snapshot.conversations.at(-1)?.id ?? '');
  }, [snapshot, active]);
  useEffect(() => { document.documentElement.lang = t.lang; document.title = 'lolPing'; }, [t]);
  const run = async (operation: () => Promise<void>) => {
    setError(null);
    try { await operation(); } catch (reason) { setError(errorCode(reason)); }
  };
  const create = () => {
    if (!snapshot?.config.defaultChatProfileId) { setActive('models'); return; }
    void run(async () => { setActive(await aiApi.create()); });
  };
  const conversation = snapshot?.conversations.find((item) => item.id === active);
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} className="ai-provider">
    <div className="ai-chat">
      <aside className="ai-sidebar">
        <div className="ai-brand"><Chat20Regular /><b>lolPing</b></div>
        <Button appearance="primary" icon={<Add20Regular />} onClick={create}>{t.aiNew}</Button>
        <div className="ai-conversations" aria-label={t.aiConversation}>
          {snapshot?.conversations.slice().reverse().map((item) => <div className={`ai-conversation-row${active === item.id ? ' selected' : ''}`} key={item.id}>
            <button className="ai-conversation-select" onClick={() => { setActive(item.id); setError(null); }}>
              <span>{conversationTitle(item, t)}</span>
              <small className={`ai-state-${item.status}`}>{t.aiStatuses[item.status]}</small>
            </button>
            <Button size="small" appearance="subtle" title={t.aiDelete} aria-label={`${t.aiDelete}: ${conversationTitle(item, t)}`}
              icon={<Delete20Regular />} onClick={() => void run(async () => {
                await aiApi.remove(item.id); updateDraft({ type: 'remove', id: item.id });
                if (active === item.id) setActive('');
              })} />
          </div>)}
          {snapshot && !snapshot.conversations.length && <p className="ai-help">{t.aiNoConversations}</p>}
        </div>
        {snapshot && <p className="ai-activity" role="status">{t.aiActivity(
          snapshot.conversations.filter((item) => item.status === 'running').length,
          snapshot.conversations.filter((item) => item.status === 'queued').length)}</p>}
        <Button appearance={active === 'timers' ? 'secondary' : 'subtle'} icon={<Timer20Regular />} onClick={() => setActive('timers')}>{t.aiTimers}
          {snapshot?.timers.length ? <Badge appearance="tint">{snapshot.timers.length}</Badge> : null}</Button>
        <Button appearance={active === 'models' ? 'secondary' : 'subtle'} icon={<BrainCircuitRegular />} onClick={() => setActive('models')}>{t.aiModels}</Button>
        <Button appearance={active.startsWith('settings') ? 'secondary' : 'subtle'} icon={<Settings20Regular />}
          onClick={() => setActive('settings')}>{t.pageTitle}</Button>
      </aside>
      <main className="ai-main">
        {snapshot?.config.paused && <div className="ai-paused"><span>{t.aiPausedNotice}</span>
          <Button size="small" onClick={() => setActive('models')}>{t.aiModels}</Button></div>}
        {error && <div className="ai-global-error ai-error" role="alert">{t.aiErrors[error]}</div>}
        {!snapshot ? <div className="ai-empty">{t.aiLoading}</div>
          : active === 'settings' || active.startsWith('settings-') ? <div className="ai-app-settings">
            <SettingsApp embedded section={active.startsWith('settings-') ? active.slice(9) : undefined} /></div>
          : active === 'models' ? <div className="ai-pane"><h1>{t.aiModels}</h1><ModelSettings snapshot={snapshot} t={t} /></div>
            : active === 'timers' ? <div className="ai-pane"><TimerPane snapshot={snapshot} t={t} models={() => setActive('models')}
              run={run} /></div>
              : conversation ? <Conversation key={conversation.id} conversation={conversation} snapshot={snapshot} t={t} run={run}
                input={drafts[conversation.id] ?? ''} setInput={(text) => updateDraft({ type: 'set', id: conversation.id, text })} />
                : <div className="ai-empty"><Chat20Regular /><h1>{t.aiChat}</h1><p>{t.aiEmpty}</p>
                  {!snapshot.config.defaultChatProfileId && <p>{t.aiConfigureFirst}</p>}
                  <Button appearance="primary" onClick={snapshot.config.defaultChatProfileId ? create : () => setActive('models')}>
                    {snapshot.config.defaultChatProfileId ? t.aiNew : t.aiModels}</Button></div>}
      </main>
    </div>
  </FluentProvider>;
}

function Conversation({ conversation, snapshot, t, run, input, setInput }: {
  conversation: AiConversation; snapshot: AiSnapshot; t: Strings;
  run: (operation: () => Promise<void>) => Promise<void>;
  input: string; setInput: (text: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const busy = conversation.status === 'running' || conversation.status === 'queued';
  const send = () => {
    if (sending || busy || snapshot.config.paused || !input.trim()) return;
    setSending(true);
    void run(async () => { await aiApi.send(conversation.id, input); setInput(''); follow.current = true; })
      .finally(() => setSending(false));
  };
  useEffect(() => {
    const element = messagesRef.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [conversation.messages]);
  return <div className="ai-conversation">
    <header className="ai-chat-header"><div><h1>{conversationTitle(conversation, t)}</h1>
      <Badge appearance="tint" color={busy ? 'brand' : conversation.status === 'error' ? 'danger' : 'informative'}>{t.aiStatuses[conversation.status]}</Badge></div>
      <label className="ai-provider-label"><span>{t.aiChooseProfile}</span>
        <select aria-label={t.aiChooseProfile} value={conversation.profileId} disabled={busy}
          onChange={(event) => void run(() => aiApi.setProfile(conversation.id, event.target.value))}>
          {!snapshot.config.profiles.some((profile) => profile.id === conversation.profileId) && <option value={conversation.profileId}>{t.aiChooseProfile}</option>}
          {snapshot.config.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
        </select>
      </label>
    </header>
    <div className="ai-messages" ref={messagesRef} onScroll={() => {
      const element = messagesRef.current;
      if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    }}>
      {!conversation.messages.length && <p className="ai-empty-message">{t.aiEmpty}</p>}
      {conversation.messages.map((message, index) => <article className={`ai-message ${message.role}`} key={message.id}>
        <div className="ai-message-label">{message.role === 'user' ? t.aiYou : t.aiAssistant}</div>
        <SafeText text={conversation.kind === 'vision' && index === 0 && message.role === 'user' ? t.aiScreenPrompt : message.content} />
        {!!message.sources?.length && <div className="ai-sources"><b>{t.aiSources}</b>{message.sources.map((source) =>
          <a key={source.url} href={source.url} onClick={(event) => { event.preventDefault(); void run(() => aiApi.openExternal(source.url)); }}>{source.title || source.url}</a>)}</div>}
        {message.role === 'assistant' && message.content && <Button size="small" appearance="subtle" onClick={() => void run(async () => {
          await aiApi.copy(message.content); setCopied(message.id);
        })}>{copied === message.id ? t.aiCopied : t.aiCopy}</Button>}
      </article>)}
      {conversation.error && <div role="alert" className="ai-error">{t.aiErrors[conversation.error]}</div>}
      {conversation.kind === 'vision' && conversation.status === 'completed' && !conversation.error
        && !conversation.messages.some((message) => message.sources?.length)
        && <p className="ai-help">{t.aiNoSources}</p>}
      {busy && <p role="status" className="ai-generation-status">{t.aiStatuses[conversation.status]}<span className="ai-pulse" /></p>}
    </div>
    <div className="ai-composer">
      <div className="ai-toolbar">
        {busy ? <Button onClick={() => void run(() => aiApi.stop(conversation.id))}>{t.aiStop}</Button>
          : conversation.messages.length > 0 && <Button disabled={snapshot.config.paused} onClick={() => void run(() => aiApi.retry(conversation.id))}>{t.aiRetry}</Button>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea aria-label={t.aiFollowup} placeholder={t.aiFollowup} value={input} maxLength={AI_LIMITS.content}
          disabled={sending} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          }} />
        <Button appearance="primary" type="submit" disabled={sending || busy || snapshot.config.paused || !input.trim()}>{t.aiSend}</Button>
      </form>
    </div>
  </div>;
}

/** Preserve model text without interpreting raw HTML or executable links. */
function SafeText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  return <div className="ai-message-text">{parts.map((part, index) => part.startsWith('```')
    ? <pre key={index}><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    : <span key={index}>{part}</span>)}</div>;
}

function TimerPane({ snapshot, t, models, run }: { snapshot: AiSnapshot; t: Strings; models: () => void;
  run: (operation: () => Promise<void>) => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <><h1>{t.aiTimers}</h1><p className="ai-help">{t.aiTimerHelp}</p>
    <Button onClick={models}>{t.aiTimerDefaults}</Button>
    {!snapshot.timers.length && <p className="ai-timer-empty">{t.aiTimerEmpty}</p>}
    {snapshot.timers.map((timer) => <TimerRow timer={timer} now={now} key={timer.id} t={t} run={run} />)}</>;
}

function TimerRow({ timer, now, t, run }: { timer: VisionTimer; now: number; t: Strings;
  run: (operation: () => Promise<void>) => Promise<void> }) {
  const [duration, setDuration] = useState(() => timerDraft(timer));
  const minutes = duration.minutes;
  useEffect(() => {
    setDuration((previous) => syncTimerDraft(previous, timer));
    setInvalid(false);
  }, [timer.createdAt, timer.dueAt]);
  const [invalid, setInvalid] = useState(false);
  const seconds = Math.max(0, Math.ceil((timer.dueAt - now) / 1000));
  return <section className="ai-timer">
    <div><strong>{t.aiTimerLocation(timer.displayId, timer.x, timer.y)}</strong>
      <div className="ai-countdown" aria-live="off">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</div></div>
    <form onSubmit={(event) => { event.preventDefault(); const value = validMinutes(minutes); setInvalid(value === null);
      if (value !== null) void run(() => aiApi.adjustTimer(timer.id, value)); }}>
      <label>{t.aiMinutes}<input type="number" min="1" max="60" step="1" required value={minutes}
        onChange={(event) => setDuration((previous) => ({ ...previous, minutes: event.target.value }))} /></label>
      <Button type="submit">{t.aiAdjust}</Button>
      <Button onClick={() => void run(() => aiApi.cancelTimer(timer.id))}>{t.aiCancel}</Button>
    </form>
    {invalid && <p className="ai-error" role="alert">{t.aiMinuteValidation}</p>}
  </section>;
}
