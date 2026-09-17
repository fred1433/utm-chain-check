-- The same measure, written for ClickHouse.
--
-- Supplied for the event contract of this repository, not executed here and not
-- written against any assumed schema of yours. Mapping it onto an analytics store
-- remains to be agreed. The executed version of this measure is in
-- src/lib/events/query.ts and runs in the checks, on the recorded test dataset.

WITH
    {experiment_id:String} AS experiment,
    {source_kind:String} AS kind,
    exposed AS (
        SELECT DISTINCT session_id
        FROM events
        WHERE experiment_id = experiment AND source_kind = kind AND event_name = 'page_opened'
    ),
    scanned AS (
        SELECT session_id, min(occurred_at) AS first_result
        FROM events
        WHERE experiment_id = experiment AND source_kind = kind AND event_name = 'scan_result_displayed'
        GROUP BY session_id
    ),
    clicked AS (
        SELECT session_id, max(occurred_at) AS last_click
        FROM events
        WHERE experiment_id = experiment AND source_kind = kind AND event_name = 'product_link_clicked'
        GROUP BY session_id
    )
SELECT
    (SELECT count() FROM exposed) AS exposed_sessions,
    (SELECT count() FROM scanned) AS sessions_with_a_result,
    (
        SELECT count()
        FROM scanned
        INNER JOIN clicked USING (session_id)
        WHERE clicked.last_click >= scanned.first_result
    ) AS sessions_with_a_result_then_a_click;
