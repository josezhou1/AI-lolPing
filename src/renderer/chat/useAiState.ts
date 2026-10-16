import { useEffect, useState } from 'react';
import type { AiSnapshot, AiErrorCode } from '../../shared/ai';
import { aiApi, errorCode } from './api';

export function useAiState() {
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [error, setError] = useState<AiErrorCode | null>(null);
  useEffect(() => {
    let alive = true;
    let received = false;
    const unsubscribe = aiApi.subscribe((value) => { received = true; if (alive) setSnapshot(value); });
    void aiApi.snapshot().then((value) => { if (alive && !received) setSnapshot(value); })
      .catch((reason: unknown) => { if (alive) setError(errorCode(reason)); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return { snapshot, error, setError };
}
