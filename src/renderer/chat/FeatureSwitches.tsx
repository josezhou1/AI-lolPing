import { Button, Switch } from '@fluentui/react-components';
import { BrainCircuitRegular, Timer20Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { AiConfig, AiSnapshot } from '../../shared/ai';
import type { Strings } from '../../shared/i18n';
import { hotkeyLabel, hotkeyParts } from '../../shared/keys';
import { api } from '../settings/api';
import { KeyCapture } from '../settings/components/KeyCapture';
import { TextContext } from '../settings/text';
import { aiApi, errorCode } from './api';
import './feature-switches.css';

export function FeatureSwitches({ snapshot, t, compact = false }: {
  snapshot: AiSnapshot; t: Strings; compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configure = async (patch: Partial<AiConfig>) => {
    setError(null); setBusy(true);
    try { await aiApi.configure(patch); }
    catch (reason) { setError(t.aiErrors[errorCode(reason)]); }
    finally { setBusy(false); }
  };
  const features = [
    { flag: 'recognitionEnabled', key: 'recognitionHotkey', title: t.aiRecognition,
      help: t.aiRecognitionHelp, icon: BrainCircuitRegular },
    { flag: 'timersEnabled', key: 'timersHotkey', title: t.aiCountdown,
      help: t.aiCountdownHelp, icon: Timer20Regular },
  ] as const;
  return <TextContext.Provider value={t}>
    <div className={`ai-feature-controls${compact ? ' compact' : ''}`}>
      {features.map((feature) => {
        const shortcut = snapshot.config[feature.key];
        const Icon = feature.icon;
        return <div className="ai-feature" key={feature.flag}>
          <div className="ai-feature-row"><Icon fontSize={20} />
            <span className="ai-feature-title">{feature.title}</span>
            <Switch checked={snapshot.config[feature.flag]} disabled={busy} aria-label={feature.title}
              title={shortcut ? hotkeyLabel(shortcut, api.platform) : t.aiFeatureHelp}
              onChange={(_, data) => void configure({ [feature.flag]: data.checked })} />
          </div>
          {!compact && <><p className="ai-help">{feature.help}</p>
            <div className="ai-feature-shortcut"><span>{t.aiFeatureShortcut}</span>
              <KeyCapture parts={shortcut ? hotkeyParts(shortcut, api.platform) : [t.aiShortcutUnset]}
                requireModifier onCapture={(key) => void configure({ [feature.key]: key })} />
              {shortcut && <Button size="small" disabled={busy}
                onClick={() => void configure({ [feature.key]: null })}>{t.aiShortcutClear}</Button>}
            </div></>}
        </div>;
      })}
      {!compact && <p className="ai-help">{t.aiFeatureHelp}</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
    </div>
  </TextContext.Provider>;
}
