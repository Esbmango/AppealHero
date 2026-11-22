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
    // Phones drop the stream when the screen locks or the app goes to the background. Resync on every reconnect,
    // when the page becomes visible again, after bfcache restores and when the network returns.
    let stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      stream?.close();
      const s = new EventSource(`/api/cases/${caseId}/stream`);
      stream = s;
      s.onopen = () => load();
      s.onmessage = (m) => {
        const event = JSON.parse(m.data) as AgentEvent;
        setEvents((xs) => [...xs.slice(-399), event]);
        clearTimeout(timer);
        timer = setTimeout(load, 60);
      };
      s.onerror = () => {
        // The browser retries on its own unless the stream is closed for good.
        if (s.readyState === EventSource.CLOSED && active) {
          clearTimeout(retry);
          retry = setTimeout(connect, 2000);
        }
      };
    };
    connect();
    const resync = () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (!stream || stream.readyState === EventSource.CLOSED) connect();
      load();
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('pageshow', resync);
    window.addEventListener('online', resync);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(retry);
      stream?.close();
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('pageshow', resync);
      window.removeEventListener('online', resync);
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

/**
 * Keep the app as tall as the *visible* viewport. iOS Safari does not shrink 100dvh when the keyboard opens, so the
 * bottom composer would sit under the keyboard; visualViewport.height does shrink. Android Chrome resizes the layout
 * (viewport meta `interactive-widget=resizes-content`) and desktop never changes, so this is a no-op there.
 */
export function useVisibleViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
        // iOS scrolls the whole page to reveal a focused input; pin it so the composer sits right above the keyboard.
        if (window.scrollY !== 0 && vv.height < window.innerHeight) window.scrollTo(0, 0);
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
