/**
 * The event contract.
 *
 * Six fields, no more. Everything the experiment card measures is computed from
 * these. The kind field is what keeps automated checks, demonstration runs and
 * real usage apart, in the collector and in the query.
 */

export const EXPERIMENT_ID = "utm-chain-check-2026-09";

export const EVENT_NAMES = [
  "page_opened",
  "scan_started",
  "scan_result_computed",
  "scan_result_displayed",
  "product_link_clicked",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const SOURCE_KINDS = ["test", "example", "live"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type ExperimentEvent = {
  experiment_id: string;
  event_id: string;
  session_id: string;
  scan_id: string | null;
  event_name: EventName;
  occurred_at: string;
  source_kind: SourceKind;
};

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export type ValidationResult =
  | { ok: true; event: ExperimentEvent }
  | { ok: false; reason: string };

export function validateEvent(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) return { ok: false, reason: "not an object" };
  const raw = input as Record<string, unknown>;

  for (const field of ["experiment_id", "event_id", "session_id", "event_name", "occurred_at", "source_kind"]) {
    if (typeof raw[field] !== "string") return { ok: false, reason: `${field} is missing` };
  }
  if (!ID.test(raw.experiment_id as string)) return { ok: false, reason: "experiment_id is not usable" };
  if (!ID.test(raw.event_id as string)) return { ok: false, reason: "event_id is not usable" };
  if (!ID.test(raw.session_id as string)) return { ok: false, reason: "session_id is not usable" };
  if (!EVENT_NAMES.includes(raw.event_name as EventName)) return { ok: false, reason: "unknown event_name" };
  if (!SOURCE_KINDS.includes(raw.source_kind as SourceKind)) return { ok: false, reason: "unknown source_kind" };

  const occurredAt = new Date(raw.occurred_at as string);
  if (Number.isNaN(occurredAt.getTime())) return { ok: false, reason: "occurred_at is not a date" };

  const scanId = raw.scan_id;
  if (scanId !== null && scanId !== undefined && (typeof scanId !== "string" || !ID.test(scanId))) {
    return { ok: false, reason: "scan_id is not usable" };
  }

  return {
    ok: true,
    event: {
      experiment_id: raw.experiment_id as string,
      event_id: raw.event_id as string,
      session_id: raw.session_id as string,
      scan_id: typeof scanId === "string" ? scanId : null,
      event_name: raw.event_name as EventName,
      occurred_at: occurredAt.toISOString(),
      source_kind: raw.source_kind as SourceKind,
    },
  };
}
