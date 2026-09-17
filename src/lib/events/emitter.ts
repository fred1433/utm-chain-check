"use client";

import { EXPERIMENT_ID, type EventName, type SourceKind } from "./contract";

/**
 * The emitter.
 *
 * It names the kind of traffic it is part of. A browser driven by an automated
 * check reports test, a run of the prefilled example reports example, and a link
 * a visitor typed reports live. The query that computes the experiment measure
 * filters on that field, which is how a check run never lands in a result.
 */

const SESSION_KEY = "utm-chain-check.session";

function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "no-storage";
  }
}

function automated(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

export function sourceKind(isExample: boolean): SourceKind {
  if (automated()) return "test";
  return isExample ? "example" : "live";
}

export async function emit(
  name: EventName,
  options: { scanId?: string | null; isExample?: boolean } = {},
): Promise<void> {
  const event = {
    experiment_id: EXPERIMENT_ID,
    event_id: crypto.randomUUID(),
    session_id: sessionId(),
    scan_id: options.scanId ?? null,
    event_name: name,
    occurred_at: new Date().toISOString(),
    source_kind: sourceKind(Boolean(options.isExample)),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      });
      if (response.ok) return;
    } catch {
      // Collection can be unavailable. The recipe of the measure counts that case
      // instead of pretending the event arrived.
    }
  }
}
