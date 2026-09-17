import { appendFileSync } from "node:fs";
import type { ExperimentEvent } from "./contract";

/**
 * Collection.
 *
 * One instance of the server keeps the events it received in memory, keyed by
 * event_id, so the same event sent twice is stored once. This is a prototype
 * collector: it holds a bounded number of events and it is not a database.
 */

const MAX_EVENTS = 5000;

export type StoreOutcome = { stored: boolean; duplicate: boolean };

export class EventStore {
  private byId = new Map<string, ExperimentEvent>();
  private order: string[] = [];

  constructor(private readonly sinkPath: string | null = null) {}

  add(event: ExperimentEvent): StoreOutcome {
    if (this.byId.has(event.event_id)) return { stored: false, duplicate: true };
    this.byId.set(event.event_id, event);
    this.order.push(event.event_id);
    while (this.order.length > MAX_EVENTS) {
      const oldest = this.order.shift();
      if (oldest) this.byId.delete(oldest);
    }
    if (this.sinkPath) {
      try {
        appendFileSync(this.sinkPath, `${JSON.stringify(event)}\n`);
      } catch {
        // A sink that cannot be written must not lose the in memory event.
      }
    }
    return { stored: true, duplicate: false };
  }

  all(): ExperimentEvent[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  count(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
    this.order = [];
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __utmChainCheckEventStore: EventStore | undefined;
}

export function eventStore(): EventStore {
  if (!globalThis.__utmChainCheckEventStore) {
    globalThis.__utmChainCheckEventStore = new EventStore(process.env.EVENT_SINK_PATH ?? null);
  }
  return globalThis.__utmChainCheckEventStore;
}
