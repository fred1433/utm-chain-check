import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { checkUrlShape, policyFromEnv } from "@/lib/net/policy";
import { scanGate } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Submitted links are never written down as they were submitted. A per process
 * salt turns the host into an opaque label, which is enough to spot abuse of a
 * single destination and tells no one what anybody scanned.
 */
const LOG_SALT = randomBytes(16).toString("hex");

function hostLabel(host: string): string {
  return createHash("sha256").update(LOG_SALT).update(host.toLowerCase()).digest("hex").slice(0, 12);
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "a JSON body is expected" }, { status: 400 });
  }

  const input = body as { url?: unknown; witnessValues?: unknown };
  if (typeof input.url !== "string") {
    return NextResponse.json({ error: "a link is expected in the url field" }, { status: 400 });
  }

  const policy = policyFromEnv();
  const shape = checkUrlShape(input.url, policy);
  if (!shape.ok) {
    return NextResponse.json(
      { error: shape.reason, outcome: "refused" },
      { status: 400, headers: { "x-content-type-options": "nosniff" } },
    );
  }

  const ip = clientIp(request);
  const destination = shape.url.hostname.toLowerCase();
  const gate = scanGate.enter(ip, destination);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason, outcome: "refused" }, { status: gate.status });
  }

  try {
    const result = await runScan(input.url, {
      witnessValues: input.witnessValues === true,
      policy,
    });
    const failed = result.outcome === "network_error" || result.outcome === "timeout";
    scanGate.leave(failed ? "failed" : "ok");
    console.log(
      `scan ${result.scanId} destination=${hostLabel(destination)} hops=${result.hops.length} outcome=${result.outcome}`,
    );
    return NextResponse.json(result, {
      headers: { "x-content-type-options": "nosniff", "cache-control": "no-store" },
    });
  } catch (error) {
    scanGate.leave("failed");
    console.error(`scan failed destination=${hostLabel(destination)}`, (error as Error).message);
    return NextResponse.json({ error: "the scan could not be completed", outcome: "network_error" }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "this endpoint accepts POST only, so submitted links never travel in a URL" },
    { status: 405, headers: { allow: "POST" } },
  );
}
