/**
 * TrueForge Event Bus, Delta Streaming, SSE Protocol & Delta Merger
 * Matching @truefoundry/trueforge-sdk & trueforge.dev/api/use-agent
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { TurnEvent, TurnEventDelta, TurnStreamOptions } from './types.ts';

export class EventBus {
  private emitter: EventEmitter;
  private eventHistory: Map<string, Array<TurnEvent | TurnEventDelta>> = new Map();
  private maxHistoryPerSession: number = 500;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(200);
  }

  /**
   * Emit an event or delta into the bus.
   */
  public emit(event: TurnEvent | TurnEventDelta): void {
    const populated = {
      ...event,
      id: event.id || randomUUID(),
      timestamp: (event as TurnEvent).timestamp || new Date().toISOString(),
    };

    // Store in session history ring buffer
    const history = this.eventHistory.get(event.sessionId) || [];
    history.push(populated);
    if (history.length > this.maxHistoryPerSession) {
      history.shift();
    }
    this.eventHistory.set(event.sessionId, history);

    // Emit session-scoped and global events
    this.emitter.emit(`session:${event.sessionId}`, populated);
    this.emitter.emit('global', populated);
  }

  /**
   * Convenience helper to emit a standard discrete event.
   */
  public emitEvent<T = unknown>(
    sessionId: string,
    threadId: string,
    type: string,
    payload: T,
    turnId?: string
  ): TurnEvent<T> {
    const event: TurnEvent<T> = {
      id: randomUUID(),
      type,
      sessionId,
      threadId,
      turnId,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.emit(event as TurnEvent);
    return event;
  }

  /**
   * Convenience helper to emit a streaming delta chunk.
   */
  public emitDelta<T = string | Record<string, unknown>>(
    sessionId: string,
    threadId: string,
    type: string,
    delta: T,
    turnId?: string
  ): TurnEventDelta<T> {
    const eventDelta: TurnEventDelta<T> = {
      id: randomUUID(),
      type,
      sessionId,
      threadId,
      turnId,
      delta,
      isDelta: true,
    };
    this.emit(eventDelta as TurnEventDelta);
    return eventDelta;
  }

  /**
   * Subscribe to events for a specific session.
   * Returns an unsubscribe function.
   */
  public onSession(
    sessionId: string,
    listener: (event: TurnEvent | TurnEventDelta) => void
  ): () => void {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Subscribe to all global events across all sessions.
   */
  public onGlobal(
    listener: (event: TurnEvent | TurnEventDelta) => void
  ): () => void {
    this.emitter.on('global', listener);
    return () => {
      this.emitter.off('global', listener);
    };
  }

  /**
   * Retrieve event history for a session, optionally after a given event ID.
   */
  public getHistory(
    sessionId: string,
    afterEventId?: string
  ): Array<TurnEvent | TurnEventDelta> {
    const events = this.eventHistory.get(sessionId) || [];
    if (!afterEventId) {
      return [...events];
    }
    const idx = events.findIndex((e) => e.id === afterEventId);
    if (idx === -1) {
      return [...events];
    }
    return events.slice(idx + 1);
  }

  /**
   * Format data into standard Server-Sent Events (SSE) wire protocol string.
   */
  public formatSSEMessage(
    eventType: string,
    data: unknown,
    id?: string
  ): string {
    const lines: string[] = [];
    if (id) {
      lines.push(`id: ${id}`);
    }
    lines.push(`event: ${eventType}`);
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    lines.push(`data: ${json}`);
    lines.push('\n');
    return lines.join('\n');
  }

  /**
   * Convert session events into a standard WHATWG ReadableStream for HTTP responses.
   */
  public toSSEStream(
    sessionId: string,
    signal?: AbortSignal,
    lastEventId?: string
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Send connection banner
        controller.enqueue(
          encoder.encode(
            this.formatSSEMessage('connected', {
              sessionId,
              timestamp: new Date().toISOString(),
            })
          )
        );

        // Replay historical events so client receives events emitted during session startup
        const history = this.getHistory(sessionId, lastEventId);
        for (const ev of history) {
          const data = 'delta' in ev ? { delta: ev.delta } : (ev as TurnEvent).payload;
          controller.enqueue(
            encoder.encode(this.formatSSEMessage(ev.type, data, ev.id))
          );
        }

        // Subscribe to live events
        cleanup = this.onSession(sessionId, (event) => {
          try {
            const data =
              'delta' in event ? { delta: event.delta } : (event as TurnEvent).payload;
            controller.enqueue(
              encoder.encode(this.formatSSEMessage(event.type, data, event.id))
            );
          } catch {
            // Stream might be closed
          }
        });

        // Handle client abort
        if (signal) {
          signal.addEventListener('abort', () => {
            if (cleanup) cleanup();
            try {
              controller.close();
            } catch {
              // Ignore
            }
          });
        }
      },
      cancel: () => {
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
      },
    });
  }

  /**
   * Clear history (for testing).
   */
  public clear(): void {
    this.eventHistory.clear();
    this.emitter.removeAllListeners();
  }
}

// Global EventBus Singleton
export const eventBus = new EventBus();

// ============================================================================
// Delta Detection & Merging Functions
// ============================================================================

/**
 * Determine if an event is an incremental delta chunk.
 */
export function isEventDelta(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const ev = event as Record<string, unknown>;
  return (
    (typeof ev.type === 'string' && ev.type.endsWith('.delta')) ||
    Boolean(ev.isDelta)
  );
}

/**
 * Accumulates streaming delta chunks into a single aggregated object.
 */
export function mergeEventDelta(
  accumulated: Record<string, unknown> | null | undefined,
  deltaEvent: Record<string, unknown>
): Record<string, unknown> {
  if (!accumulated) {
    const base: Record<string, unknown> = JSON.parse(JSON.stringify(deltaEvent));
    if (typeof base.type === 'string' && base.type.endsWith('.delta')) {
      base.type = base.type.slice(0, -6);
    }
    delete base.isDelta;
    if (typeof base.delta === 'string') {
      base.content = base.delta;
      delete base.delta;
    } else if (typeof base.delta === 'object' && base.delta !== null) {
      Object.assign(base, base.delta);
      delete base.delta;
    }
    base.lastUpdated = new Date().toISOString();
    return base;
  }

  // Merge string text content deltas
  if (typeof deltaEvent.delta === 'string') {
    accumulated.content = ((accumulated.content as string) || '') + deltaEvent.delta;
  } else if (typeof deltaEvent.delta === 'object' && deltaEvent.delta !== null) {
    Object.assign(accumulated, deltaEvent.delta);
  }

  if (typeof deltaEvent.text === 'string') {
    accumulated.text = ((accumulated.text as string) || '') + deltaEvent.text;
  }

  if (typeof deltaEvent.data === 'string') {
    accumulated.text = ((accumulated.text as string) || '') + deltaEvent.data;
  }

  // Merge tool call chunks
  if (deltaEvent.toolCallDelta && typeof deltaEvent.toolCallDelta === 'object') {
    if (!accumulated.toolCall || typeof accumulated.toolCall !== 'object') {
      accumulated.toolCall = {};
    }
    const tc = accumulated.toolCall as Record<string, unknown>;
    const tcd = deltaEvent.toolCallDelta as Record<string, unknown>;
    if (typeof tcd.name === 'string') {
      tc.name = ((tc.name as string) || '') + tcd.name;
    }
    if (typeof tcd.arguments === 'string') {
      tc.rawArgs = ((tc.rawArgs as string) || '') + tcd.arguments;
    }
  }

  accumulated.lastUpdated = new Date().toISOString();
  return accumulated;
}

// ============================================================================
// Turn Stream Client Implementation (Matching trueforge.dev/api/use-agent)
// ============================================================================

export function createTurnStream(
  options: TurnStreamOptions
): AsyncIterable<TurnEvent | TurnEventDelta> {
  const { sessionId, onEvent, onDelta, onError, signal } = options;

  return {
    [Symbol.asyncIterator]() {
      const queue: Array<TurnEvent | TurnEventDelta> = [];
      let resolveNext: (() => void) | null = null;
      let isDone = false;

      const unsubscribe = eventBus.onSession(sessionId, (event) => {
        queue.push(event);

        if (isEventDelta(event)) {
          if (onDelta) onDelta(event as TurnEventDelta);
        } else {
          if (onEvent) onEvent(event as TurnEvent);
        }

        if (
          event.type === 'session.completed' ||
          event.type === 'session.error' ||
          event.type === 'error'
        ) {
          isDone = true;
        }

        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          isDone = true;
          unsubscribe();
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        });
      }

      return {
        async next(): Promise<IteratorResult<TurnEvent | TurnEventDelta>> {
          while (queue.length === 0 && !isDone) {
            if (signal?.aborted) {
              unsubscribe();
              return { done: true, value: undefined };
            }
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }

          if (queue.length > 0) {
            return { done: false, value: queue.shift()! };
          }

          unsubscribe();
          return { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<TurnEvent | TurnEventDelta>> {
          unsubscribe();
          isDone = true;
          return { done: true, value: undefined };
        },
        async throw(err?: unknown): Promise<IteratorResult<TurnEvent | TurnEventDelta>> {
          unsubscribe();
          isDone = true;
          if (onError && err instanceof Error) onError(err);
          throw err;
        },
      };
    },
  };
}
