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
  const reload = useRef<() => void>(() => {});
  const refresh = useCallback(() => reload.current(), []);
  useEffect(() => {
    setC(null);
    setEvents([]);
    if (!caseId) return;
    let active = true,
      request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const sequence = ++request;
      void api.getCase(caseId).then(
        (value) => {
          if (active && sequence === request) setC(value);
        },
        (error) => {
          if (active && sequence === request) handle(error);
        },
      );
    };
    reload.current = load;
    load();
    const stream = new EventSource(`/api/cases/${caseId}/stream`);
    stream.onmessage = (m) => {
      const event = JSON.parse(m.data) as AgentEvent;
      setEvents((xs) => [...xs.slice(-399), event]);
      clearTimeout(timer);
      timer = setTimeout(load, 60);
    };
    return () => {
      active = false;
      clearTimeout(timer);
      stream.close();
      reload.current = () => {};
    };
  }, [caseId]);
  return { c: c?.id === caseId ? c : null, events, refresh };
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
