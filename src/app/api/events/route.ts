import { NextRequest, NextResponse } from "next/server";
import { validateEvent } from "@/lib/events/contract";
import { eventStore } from "@/lib/events/store";
import { SlidingCounter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = new SlidingCounter(60_000);

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  if (!perIp.take(clientIp(request), 120)) {
    return NextResponse.json({ error: "too many events from this address" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "a JSON body is expected" }, { status: 400 });
  }

  const payload = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: unknown[] }).events)
      : [body];

  if (payload.length > 20) {
    return NextResponse.json({ error: "at most 20 events per request" }, { status: 400 });
  }

  const store = eventStore();
  let stored = 0;
  let duplicates = 0;
  const rejected: string[] = [];

  for (const candidate of payload) {
    const validation = validateEvent(candidate);
    if (!validation.ok) {
      rejected.push(validation.reason);
      continue;
    }
    const outcome = store.add(validation.event);
    if (outcome.duplicate) duplicates += 1;
    else stored += 1;
  }

  return NextResponse.json(
    { received: payload.length, stored, duplicates, rejected },
    { status: rejected.length === payload.length && payload.length > 0 ? 400 : 202 },
  );
}
