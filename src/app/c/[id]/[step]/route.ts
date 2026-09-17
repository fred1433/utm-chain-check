import { NextRequest } from "next/server";
import {
  applyTransform,
  parsePairs,
  scenarioById,
  serializePairs,
} from "@/lib/chains/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HONEYPOT_KEY = "honeypot_port";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; step: string }> },
) {
  const { id, step } = await context.params;
  const scenario = scenarioById(id);
  if (!scenario) {
    return new Response("Unknown control chain.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const index = Number.parseInt(step, 10);
  if (!Number.isInteger(index) || index < 0 || index > scenario.hops.length) {
    return new Response("Unknown step of this control chain.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // The raw request line is read, not a parsed copy of it: a control chain has to
  // forward the exact bytes it received, otherwise it re-encodes values by accident
  // and stops being an oracle.
  const questionMark = request.url.indexOf("?");
  const rawQuery = questionMark === -1 ? "" : request.url.slice(questionMark + 1);
  const pairs = parsePairs(rawQuery);

  if (index < scenario.hops.length) {
    const hop = scenario.hops[index];
    const nextPairs = applyTransform(pairs, hop.transform);
    const nextQuery = serializePairs(nextPairs);

    let location: string;
    if (scenario.lastHopTo === "self" && index === scenario.hops.length - 1) {
      location = `/c/${scenario.id}/${index}${nextQuery ? `?${nextQuery}` : ""}`;
    } else if (
      scenario.lastHopTo === "loopback-honeypot" &&
      index === scenario.hops.length - 1
    ) {
      // Deliberate: this hop points at the loopback interface of whatever machine
      // runs the checker. It is the fixture of the security recipe, and the only
      // destination it can ever name is 127.0.0.1 on a numeric port.
      const requested = request.nextUrl.searchParams.get(HONEYPOT_KEY);
      const port = requested && /^\d{1,5}$/.test(requested) ? Number(requested) : 9;
      const safePort = port >= 1 && port <= 65535 ? port : 9;
      location = `http://127.0.0.1:${safePort}/`;
    } else {
      location = `/c/${scenario.id}/${index + 1}${nextQuery ? `?${nextQuery}` : ""}`;
    }

    return new Response(null, {
      status: hop.status,
      headers: {
        location,
        "cache-control": "no-store",
        "x-control-chain": `${scenario.id}/${index}`,
      },
    });
  }

  if (scenario.landing.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, scenario.landing.delayMs));
  }

  if (scenario.landing.bodyBytes) {
    const chunk = "x".repeat(16 * 1024);
    const total = scenario.landing.bodyBytes;
    const stream = new ReadableStream({
      start(controller) {
        let sent = 0;
        while (sent < total) {
          const size = Math.min(chunk.length, total - sent);
          controller.enqueue(new TextEncoder().encode(chunk.slice(0, size)));
          sent += size;
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: scenario.landing.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const rows = pairs
    .map(
      ([k, v]) =>
        `<tr><td>${escapeHtml(decodeURIComponent(k.replace(/\+/g, " ")))}</td><td>${escapeHtml(
          decodeURIComponent(v.replace(/\+/g, " ")),
        )}</td></tr>`,
    )
    .join("");

  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Control chain ${escapeHtml(
    scenario.id,
  )}, final destination</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;margin:48px auto;max-width:640px;padding:0 20px;color:#101013}
h1{font-size:19px;font-weight:600}table{border-collapse:collapse;margin-top:16px;font-family:ui-monospace,monospace;font-size:13px}
td{border-bottom:1px solid #e8e8e6;padding:6px 18px 6px 0}p{color:#6b6b76}</style></head>
<body><h1>Control chain ${escapeHtml(scenario.id)}, final destination</h1>
<p>${escapeHtml(scenario.behaviour)}</p>
<table>${rows || "<tr><td>no parameter</td><td></td></tr>"}</table>
<p>Status ${scenario.landing.status}. This page exists so the checker can be tested against a chain whose behaviour is known in advance.</p>
</body></html>`;

  return new Response(body, {
    status: scenario.landing.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
