import { DatabaseSync } from "node:sqlite";
import type { ExperimentEvent } from "./contract";

/**
 * The primary measure, executed.
 *
 * The query runs against the event contract above, on the events this collector
 * actually recorded, in a portable SQL engine. Mapping it onto another analytics
 * store remains to be agreed: the ClickHouse wording of the same query is supplied
 * next to this file and is not executed here.
 */

export const PRIMARY_METRIC_SQL = `
WITH exposed AS (
  SELECT DISTINCT session_id
  FROM events
  WHERE experiment_id = :experiment_id
    AND source_kind = :source_kind
    AND event_name = 'page_opened'
),
scanned AS (
  SELECT session_id, MIN(occurred_at) AS first_result
  FROM events
  WHERE experiment_id = :experiment_id
    AND source_kind = :source_kind
    AND event_name = 'scan_result_displayed'
  GROUP BY session_id
),
clicked AS (
  SELECT session_id, MAX(occurred_at) AS last_click
  FROM events
  WHERE experiment_id = :experiment_id
    AND source_kind = :source_kind
    AND event_name = 'product_link_clicked'
  GROUP BY session_id
)
SELECT
  (SELECT COUNT(*) FROM exposed) AS exposed_sessions,
  (SELECT COUNT(*) FROM scanned) AS sessions_with_a_result,
  (SELECT COUNT(*)
     FROM scanned
     JOIN clicked ON clicked.session_id = scanned.session_id
    WHERE clicked.last_click >= scanned.first_result) AS sessions_with_a_result_then_a_click
`;

export type PrimaryMetric = {
  experiment_id: string;
  source_kind: string;
  exposed_sessions: number;
  sessions_with_a_result: number;
  sessions_with_a_result_then_a_click: number;
};

export function primaryMetric(
  events: ExperimentEvent[],
  experimentId: string,
  sourceKind: string,
): PrimaryMetric {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE events (
      experiment_id TEXT NOT NULL,
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      scan_id TEXT,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source_kind TEXT NOT NULL
    )`);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO events
       (experiment_id, event_id, session_id, scan_id, event_name, occurred_at, source_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      insert.run(
        event.experiment_id,
        event.event_id,
        event.session_id,
        event.scan_id,
        event.event_name,
        event.occurred_at,
        event.source_kind,
      );
    }
    const row = db
      .prepare(PRIMARY_METRIC_SQL)
      .get({ experiment_id: experimentId, source_kind: sourceKind }) as Record<string, number>;
    return {
      experiment_id: experimentId,
      source_kind: sourceKind,
      exposed_sessions: Number(row.exposed_sessions ?? 0),
      sessions_with_a_result: Number(row.sessions_with_a_result ?? 0),
      sessions_with_a_result_then_a_click: Number(row.sessions_with_a_result_then_a_click ?? 0),
    };
  } finally {
    db.close();
  }
}
