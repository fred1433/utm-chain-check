# Experiment card

**UTM Chain Check. A working campaign link experiment, with tested instrumentation.**
Functional checks completed. Growth impact not evaluated.

This card is a proposed protocol, not a report of results. Nothing here has been run
on real visitors, and no number in this repository comes from traffic.

## Hypothesis

A reader who is told which campaign parameter changed, at which transition, with the
values before and after, is more likely to act on their own links than a reader who is
told only that the chain has three hops and ends on a 200.

## Distribution

One entry point from the guide that already asks for this check, subject to the
agreement of whoever owns that page. A page that sits outside a site builds no
audience of its own, and this card does not assume otherwise. Without an entry point,
the honest outcome of the experiment is insufficient exposure.

## Primary measure

Sessions that ran a scan on a link of their own and then clicked through, over
sessions exposed.

* the denominator is sessions with a `page_opened` event of kind `live`
* the numerator is sessions with a `scan_result_displayed` of kind `live` followed, at
  a later timestamp, by a `product_link_clicked`
* a run of the prefilled example carries the kind `example` and is therefore outside
  the numerator, while the session still counts as exposed
* a browser driven by an automated check reports the kind `test` and is outside both

The measure is computed by the query in `src/lib/events/query.ts`, which runs in the
checks against the recorded dataset of `fixtures/events-recipe.json`. The ClickHouse
wording of the same measure is in `docs/queries/primary_metric.clickhouse.sql`, is
supplied for this contract only, and is not executed here.

## Guardrails

* scans that end in a refusal or a timeout
* events refused by the collector, by reason
* outbound requests per minute, per address and per destination
* any security defect stops the experiment at once, before any reading of the measure

## Decision

A review at fourteen days, as a management choice and not as a statistical claim. If
exposure is too low to separate anything, the result is reported as insufficient
exposure. No conversion target is invented here, and no lift is promised.

## Scope

The measure is a signal of movement towards the product, not a sign up and not
revenue. What happens after the click is outside this page and is not claimed.

## The event contract

| Field | Meaning |
|---|---|
| `experiment_id` | which experiment the event belongs to |
| `event_id` | identity of one event, used to store it once |
| `session_id` | identity of one visit, kept in the browser session only |
| `scan_id` | the scan the event refers to, empty when there is none |
| `event_name` | `page_opened`, `scan_started`, `scan_result_computed`, `scan_result_displayed`, `product_link_clicked` |
| `occurred_at` | when the browser produced the event |
| `source_kind` | `test`, `example` or `live` |

`scan_result_computed` and `scan_result_displayed` are two different events on
purpose: a result that was computed and never reached the screen is not a result the
reader saw.

No link submitted by a visitor is ever part of an event, and no identifier is stored
beyond the browser session.

## Recipe of the measure, expected against received

Run by `npm test`, printed by the suite, from `fixtures/events-recipe.json`.

| Case | Emitted | Received | Stored | Counted as |
|---|---|---|---|---|
| a visitor runs a scan on a link of their own, then clicks through | 5 | 5 | 5 | exposed, result, result then click |
| a visitor reads a result and leaves | 4 | 4 | 4 | exposed, result |
| a scan is interrupted before a result exists | 2 | 2 | 2 | exposed |
| a click happens before any result was displayed | 5 | 5 | 5 | exposed, result |
| a visitor only runs the prefilled example | 5 | 5 | 5 | exposed |
| an automated check drives the page | 5 | 5 | 5 | nothing, kind `test` |
| the same event is delivered twice | 6 | 6 | 5 | exposed, result, result then click |
| collection is unavailable when the click happens | 5 | 4 | 4 | exposed, result |

Expected measure on that dataset: 7 sessions exposed, 5 with a result, 2 with a result
followed by a click. The gap in the last case is reported as a gap and is not filled
in.

## The journey, executed

`npm run test:journey` drives a real browser: it opens the page, runs a scan, waits
for the sentence naming the dropped parameter, clicks through, then reads the events
back from the collector and computes the measure. A second check runs the same journey
with the emitter neutralised and requires it to fail. An instrumentation check that
still passes when nothing is emitted would be measuring nothing.
