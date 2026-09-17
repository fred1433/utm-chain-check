import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { validateEvent, type ExperimentEvent } from "@/lib/events/contract";
import { EventStore } from "@/lib/events/store";
import { primaryMetric } from "@/lib/events/query";

type RecipeCase = {
  name: string;
  events: unknown[];
  expected_received: number;
  expected_stored: number;
  expected_sent?: number;
  note: string;
};

const recipe = JSON.parse(readFileSync("fixtures/events-recipe.json", "utf8")) as {
  experiment_id: string;
  cases: RecipeCase[];
  expected_metric: Record<string, Record<string, number>>;
};

const table: string[] = [];

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(["", "Recipe of the measure, expected against received", ...table, ""].join("\n"));
});

describe("the event contract refuses what it cannot count", () => {
  const valid = {
    experiment_id: "utm-chain-check-2026-09",
    event_id: "e1",
    session_id: "s1",
    scan_id: null,
    event_name: "page_opened",
    occurred_at: "2026-09-17T10:00:00.000Z",
    source_kind: "live",
  };

  it("accepts a complete event", () => {
    expect(validateEvent(valid).ok).toBe(true);
  });

  const broken: [string, Record<string, unknown>][] = [
    ["an unknown event name", { event_name: "signed_up" }],
    ["an unknown kind of traffic", { source_kind: "production" }],
    ["a date that is not a date", { occurred_at: "yesterday" }],
    ["an identifier with a quote in it", { session_id: "s1' OR 1=1" }],
    ["an identifier that is far too long", { event_id: "x".repeat(65) }],
    ["a missing session", { session_id: undefined }],
  ];
  for (const [why, patch] of broken) {
    it(`refuses ${why}`, () => {
      expect(validateEvent({ ...valid, ...patch }).ok).toBe(false);
    });
  }
});

describe("collection, deduplication and the measure", () => {
  it("stores an event once, however many times it arrives", () => {
    const store = new EventStore();
    const event = validateEvent({ ...{
      experiment_id: "utm-chain-check-2026-09",
      event_id: "twice",
      session_id: "s",
      scan_id: null,
      event_name: "scan_result_displayed",
      occurred_at: "2026-09-17T10:00:00.000Z",
      source_kind: "live",
    } });
    expect(event.ok).toBe(true);
    if (!event.ok) return;
    expect(store.add(event.event)).toEqual({ stored: true, duplicate: false });
    expect(store.add(event.event)).toEqual({ stored: false, duplicate: true });
    expect(store.count()).toBe(1);
  });

  it("runs the recipe: every case lands where it should", () => {
    const store = new EventStore();
    for (const testCase of recipe.cases) {
      let stored = 0;
      for (const candidate of testCase.events) {
        const validation = validateEvent(candidate);
        expect(validation.ok, `${testCase.name}: an event of the recipe is not valid`).toBe(true);
        if (validation.ok && store.add(validation.event).stored) stored += 1;
      }
      expect(testCase.events.length).toBe(testCase.expected_received);
      expect(stored).toBe(testCase.expected_stored);
      const sent = testCase.expected_sent ?? testCase.expected_received;
      table.push(
        `  ${testCase.name}: emitted ${sent}, received ${testCase.expected_received}, stored ${stored}${
          sent !== testCase.expected_received ? ", one event never arrived" : ""
        }`,
      );
    }
  });

  it("computes the measure the experiment card describes, on the recorded events", () => {
    const store = new EventStore();
    const events: ExperimentEvent[] = [];
    for (const testCase of recipe.cases) {
      for (const candidate of testCase.events) {
        const validation = validateEvent(candidate);
        if (validation.ok && store.add(validation.event).stored) events.push(validation.event);
      }
    }

    for (const [kind, expected] of Object.entries(recipe.expected_metric)) {
      const metric = primaryMetric(events, recipe.experiment_id, kind);
      expect({
        exposed_sessions: metric.exposed_sessions,
        sessions_with_a_result: metric.sessions_with_a_result,
        sessions_with_a_result_then_a_click: metric.sessions_with_a_result_then_a_click,
      }).toEqual(expected);
    }
  });

  it("counts nothing for an experiment that recorded nothing", () => {
    expect(primaryMetric([], "another-experiment", "live")).toMatchObject({
      exposed_sessions: 0,
      sessions_with_a_result: 0,
      sessions_with_a_result_then_a_click: 0,
    });
  });
});
