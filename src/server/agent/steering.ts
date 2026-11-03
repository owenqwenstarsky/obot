/**
 * In-memory queue of steering messages for one live run. Messages are injected into the
 * model's input at the next step boundary. Everything here is synchronous so that
 * "enqueue" and "decide to finish" can never interleave badly.
 */
import type { PendingSteer } from "@/lib/run-events";

export class SteeringQueue {
  private items: PendingSteer[] = [];
  private closed = false;
  private subs = new Set<() => void>();

  /** Returns false if the run is already finishing (the caller should start a new turn instead). */
  enqueue(s: PendingSteer): boolean {
    if (this.closed) return false;
    this.items.push(s);
    for (const cb of this.subs) {
      try {
        cb();
      } catch {
        // ignore subscriber errors
      }
    }
    return true;
  }

  drain(): PendingSteer[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  hasPending(): boolean {
    return this.items.length > 0;
  }

  isClosed(): boolean {
    return this.closed;
  }

  onEnqueue(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** Atomically decide to finish: closes and returns true only if nothing is queued. */
  closeIfEmpty(): boolean {
    if (this.items.length > 0) return false;
    this.closed = true;
    return true;
  }

  /** Close unconditionally (stop/failure). Returns undelivered messages. */
  close(): PendingSteer[] {
    this.closed = true;
    this.subs.clear();
    return this.drain();
  }

  snapshot(): PendingSteer[] {
    return this.items.slice();
  }
}
