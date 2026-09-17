import { NextRequest, NextResponse } from "next/server";
import { EXPERIMENT_ID } from "@/lib/events/contract";
import { eventStore } from "@/lib/events/store";
import { primaryMetric } from "@/lib/events/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reading the collected events back.
 *
 * This route only exists when an operator sets EVENT_SUMMARY_TOKEN. The deployed
 * instance does not set it, so the events it collects are not readable from the
 * outside. The end to end journey check sets it on its own server.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.EVENT_SUMMARY_TOKEN;
  if (!expected) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (request.headers.get("x-summary-token") !== expected) {
    return new NextResponse("Not found", { status: 404 });
  }

  const events = eventStore().all();
  const experimentId = request.nextUrl.searchParams.get("experiment_id") ?? EXPERIMENT_ID;
  const sourceKind = request.nextUrl.searchParams.get("source_kind") ?? "live";

  const byName: Record<string, number> = {};
  for (const event of events) {
    const key = `${event.source_kind}:${event.event_name}`;
    byName[key] = (byName[key] ?? 0) + 1;
  }

  return NextResponse.json({
    collected: events.length,
    by_kind_and_name: byName,
    metric: primaryMetric(events, experimentId, sourceKind),
    events,
  });
}
