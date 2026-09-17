import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type TestServer } from "../helpers/server";

/**
 * The measurement journey, end to end.
 *
 * A real browser opens the page, runs a scan, reads the result and clicks through.
 * The events are then read back from the collector and the measure is computed from
 * them. The second check neutralises the emitter and requires this same journey to
 * fail: an instrumentation check that still passes with the emitter silenced would
 * be measuring nothing.
 */

const TOKEN = "journey-token";

let server: TestServer;
let browser: Browser;

beforeAll(async () => {
  server = await startServer((port) => ({
    EVENT_SUMMARY_TOKEN: TOKEN,
    UTM_CHAIN_CHECK_ALLOWLIST: `127.0.0.1:${port}`,
  }));
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

type Summary = {
  collected: number;
  by_kind_and_name: Record<string, number>;
  metric: Record<string, number>;
  events: { session_id: string; event_name: string; source_kind: string; event_id: string }[];
};

async function summary(sourceKind: string): Promise<Summary> {
  const response = await fetch(`${server.baseUrl}/api/events/summary?source_kind=${sourceKind}`, {
    headers: { "x-summary-token": TOKEN },
  });
  if (!response.ok) throw new Error(`the collector did not answer: ${response.status}`);
  return (await response.json()) as Summary;
}

async function runJourney(page: Page, options: { blockEmitter?: boolean } = {}): Promise<string> {
  // No request ever leaves the machine during this check.
  await page.route("**://*.redirhub.com/**", (route) => route.abort());
  if (options.blockEmitter) {
    await page.route("**/api/events", (route) => route.abort());
  }

  await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLInputElement>("#chain-url");
    return Boolean(input && input.value.includes("/c/"));
  });

  const sessionId = await page.evaluate(() => window.sessionStorage.getItem("utm-chain-check.session"));

  await page.fill("#chain-url", `${server.baseUrl}/c/dropped/0?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link`);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=utm_content removed at redirect 2", { timeout: 30_000 });

  await page.click("a:has-text('here')");
  await page.waitForTimeout(1200);

  if (!sessionId) throw new Error("the page did not open a session");
  return sessionId;
}

async function verifyJourney(sessionId: string): Promise<void> {
  const collected = await summary("test");
  const mine = collected.events.filter((event) => event.session_id === sessionId);
  const names = new Set(mine.map((event) => event.event_name));
  for (const expected of [
    "page_opened",
    "scan_started",
    "scan_result_computed",
    "scan_result_displayed",
    "product_link_clicked",
  ]) {
    if (!names.has(expected)) {
      throw new Error(`the journey produced no ${expected} event`);
    }
  }
  if (mine.some((event) => event.source_kind !== "test")) {
    throw new Error("a browser driven by an automated check reported itself as live traffic");
  }
}

describe("the measurement journey", () => {
  it("is observable from the browser to the query", async () => {
    const page = await browser.newPage();
    const sessionId = await runJourney(page);
    await verifyJourney(sessionId);

    const before = await summary("test");
    const mine = before.events.filter((event) => event.session_id === sessionId);

    // The same event delivered twice is stored once.
    const duplicate = mine[0];
    const response = await fetch(`${server.baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        before.events.find((event) => event.event_id === duplicate.event_id),
      ),
    });
    expect(response.status).toBe(202);
    expect((await response.json()).duplicates).toBe(1);

    const after = await summary("test");
    expect(after.collected).toBe(before.collected);

    // The measure is computed on what was recorded, and the live column stays empty:
    // an automated run is not usage.
    expect(after.metric.exposed_sessions).toBeGreaterThanOrEqual(1);
    expect(after.metric.sessions_with_a_result).toBeGreaterThanOrEqual(1);
    expect(after.metric.sessions_with_a_result_then_a_click).toBeGreaterThanOrEqual(1);
    const live = await summary("live");
    expect(live.metric.exposed_sessions).toBe(0);

    await page.close();
  }, 120_000);

  it("fails when the emitter is neutralised", async () => {
    const page = await browser.newPage();
    const sessionId = await runJourney(page, { blockEmitter: true });
    await expect(verifyJourney(sessionId)).rejects.toThrow(/produced no/);
    await page.close();
  }, 120_000);
});
