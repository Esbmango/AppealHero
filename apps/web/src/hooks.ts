import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, CaseView } from '@appealhero/shared';
import { api, ApiError } from './api';

/** Server is the source of truth: any SSE event → refetch the case. EventSource resends Last-Event-ID on reconnect. */
export function useCase(caseId: string | null, onGone?: () => void) {
  // The case vanished (e.g. a demo reset on the server): tell the app so the phone returns to the start screen.
  const gone = useRef(onGone);
  gone.current = onGone;
  const handle = (e: unknown) => {
    if (e instanceof ApiError && e.status === 404) gone.current?.();
  };
  const [c, setC] = useState<CaseView | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setC(null);
    setEvents([]);
    if (!caseId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api.getCase(caseId).then(
          (v) => alive && setC(v),
          (e) => alive && handle(e),
        );
      }, 60);
    };
    load();
    const es = new EventSource(`/api/cases/${caseId}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent;
      setEvents((xs) => (xs.length > 400 ? [...xs.slice(-300), e] : [...xs, e]));
      load();
    };
    return () => {
      alive = false;
      clearTimeout(timer);
      es.close();
    };
  }, [caseId]);

  useEffect(() => {
    if (caseId && tick) api.getCase(caseId).then(setC, handle);
  }, [caseId, tick]);

  return { c, events, refresh };
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [v, set] as const;
}
