import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentEvent } from '@appealhero/shared';

interface Logged {
  id: number;
  event: AgentEvent;
}

/**
 * Per-case event log + pub/sub, served as SSE with Last-Event-ID replay
 * (phones drop the connection when the screen locks or the tab is backgrounded).
 * Screenshots are never inlined — events only carry URLs.
 */
export class EventHub {
  private seq = 0;
  private logs = new Map<string, Logged[]>();
  private subs = new Map<string, Set<(e: Logged) => void>>();

  emit(event: AgentEvent) {
    const logged = { id: ++this.seq, event };
    const log = this.logs.get(event.caseId) ?? [];
    log.push(logged);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    this.logs.set(event.caseId, log);
    for (const key of [event.caseId, '*']) this.subs.get(key)?.forEach((fn) => fn(logged));
  }

  since(caseId: string, afterId: number): Logged[] {
    return (this.logs.get(caseId) ?? []).filter((e) => e.id > afterId);
  }

  subscribe(key: string, fn: (e: Logged) => void): () => void {
    const set = this.subs.get(key) ?? new Set();
    set.add(fn);
    this.subs.set(key, set);
    return () => set.delete(fn);
  }

  clear() {
    this.logs.clear();
  }

  /** Serve an SSE stream for one case, or '*' for all cases. */
  serve(req: FastifyRequest, reply: FastifyReply, key: string) {
    const q = req.query as { lastEventId?: string };
    let lastId = Number(req.headers['last-event-id'] ?? q.lastEventId ?? 0) || 0;
    if (lastId > this.seq) lastId = 0; // the server restarted (ids start over): replay everything we have
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    const send = (e: Logged) => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e.event)}\n\n`);
    if (key !== '*') this.since(key, lastId).forEach(send);
    const unsubscribe = this.subscribe(key, send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
