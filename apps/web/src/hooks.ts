import { useCallback, useEffect, useState } from 'react';
import type { AgentEvent, CaseView } from '@appealhero/shared';
import { api } from './api';

/** Server is the source of truth: any SSE event → refetch the case. EventSource resends Last-Event-ID on reconnect. */
export function useCase(caseId: string | null) {
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
          () => undefined,
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
    if (caseId && tick) api.getCase(caseId).then(setC, () => undefined);
  }, [caseId, tick]);

  return { c, events, refresh };
}

/** Desktop console follows the newest case (e.g. one created on the presenter's phone). */
export function useLatestCaseId(enabled: boolean, since: string) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      try {
        const list = await api.listCases();
        const newest = list.find((c) => c.createdAt > since);
        if (alive) setId(newest?.id ?? null);
      } catch {
        /* server restarting */
      }
    };
    void poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled, since]);
  return id;
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
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
