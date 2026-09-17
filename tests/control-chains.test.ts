import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScan, type ScanResult } from "@/lib/scan";
import { policyFromEnv, type Policy } from "@/lib/net/policy";
import { publicScenarios, SCENARIOS } from "@/lib/chains/scenarios";
import { startServer, type TestServer } from "./helpers/server";

/**
 * The control chains are the oracle.
 *
 * Each chain is hosted by this application and states in advance what it does, so
 * the expected report is known without trusting the checker. A scenario without an
 * expectation below fails the suite.
 */

const WITNESS = "utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link";

let server: TestServer;
let policy: Policy;

beforeAll(async () => {
  server = await startServer();
  policy = policyFromEnv({ UTM_CHAIN_CHECK_ALLOWLIST: `127.0.0.1:${server.port}` });
}, 120_000);

afterAll(async () => {
  await server?.stop();
});

async function scan(id: string, query = WITNESS): Promise<ScanResult> {
  return runScan(`http://127.0.0.1:${server.port}/c/${id}/0?${query}`, { policy });
}

function status(result: ScanResult, key: string): string | undefined {
  return result.verdicts.find((v) => v.key === key)?.status;
}

const expectations: Record<string, (result: ScanResult) => void> = {
  preserved: (result) => {
    expect(result.outcome).toBe("completed");
    expect(result.finalStatus).toBe(200);
    expect(result.hops).toHaveLength(4);
    expect(result.verdicts.every((v) => v.status === "preserved")).toBe(true);
    expect(result.summary.join(" ")).toContain("3 redirects");
  },
  dropped: (result) => {
    expect(status(result, "utm_content")).toBe("missing");
    expect(status(result, "utm_source")).toBe("preserved");
    const change = result.transitions[1].changes.find((c) => c.key === "utm_content");
    expect(change?.type).toBe("removed");
    expect(result.summary.join(" ")).toContain("utm_content removed at redirect 2");
  },
  changed: (result) => {
    expect(status(result, "utm_campaign")).toBe("changed");
    const change = result.transitions[1].changes.find((c) => c.key === "utm_campaign");
    expect(change).toMatchObject({ type: "modified", before: ["spring-sale"], after: ["summer-sale"] });
    expect(result.summary.join(" ")).toContain("utm_campaign changed at redirect 2: spring-sale to summer-sale");
  },
  duplicated: (result) => {
    expect(status(result, "utm_source")).toBe("duplicated");
    expect(result.verdicts.find((v) => v.key === "utm_source")?.final).toEqual(["newsletter", "partner"]);
    expect(result.transitions[0].changes.find((c) => c.key === "utm_source")?.type).toBe("duplicated");
  },
  restored: (result) => {
    expect(status(result, "utm_medium")).toBe("preserved");
    expect(result.verdicts.find((v) => v.key === "utm_medium")?.absentInTransit).toBe(true);
    expect(result.summary.join(" ")).toContain("absent from an intermediate hop");
  },
  reencoded: (result) => {
    expect(status(result, "utm_campaign")).toBe("reencoded");
    expect(result.transitions[0].changes.find((c) => c.key === "utm_campaign")?.type).toBe("reencoded");
    expect(result.summary.join(" ")).toContain("written with a different encoding");
  },
  stripped: (result) => {
    expect(result.verdicts.filter((v) => v.campaign).every((v) => v.status === "missing")).toBe(true);
    expect(result.finalStatus).toBe(200);
  },
  loop: (result) => {
    expect(result.outcome).toBe("loop");
    expect(result.finalStatus).toBeNull();
  },
  broken: (result) => {
    expect(result.outcome).toBe("completed");
    expect(result.finalStatus).toBe(404);
    expect(result.verdicts.filter((v) => v.campaign).every((v) => v.status === "preserved")).toBe(true);
  },
};

describe("every control chain reports what it says it reports", () => {
  for (const scenario of publicScenarios()) {
    it(`${scenario.id}: ${scenario.expectation}`, async () => {
      const assertion = expectations[scenario.id];
      expect(assertion, `no expectation is written for the control chain ${scenario.id}`).toBeTypeOf("function");
      assertion(await scan(scenario.id));
    });
  }

  it("covers every control chain, hidden ones included", () => {
    const covered = new Set([...Object.keys(expectations), "slow", "oversized", "private-hop"]);
    for (const scenario of SCENARIOS) {
      expect(covered.has(scenario.id), `${scenario.id} has no check`).toBe(true);
    }
  });

  it("does not call a link without campaign parameters a success", async () => {
    const result = await scan("preserved", "ref=partner");
    expect(result.summary.join(" ")).toContain("This is not a pass");
  });

  it("says so when witness values were added on purpose", async () => {
    const result = await runScan(`http://127.0.0.1:${server.port}/c/dropped/0`, {
      policy,
      witnessValues: true,
    });
    expect(result.witnessValues).toBe(true);
    expect(result.submitted).toContain("utm_source=chain-check");
    expect(status(result, "utm_content")).toBe("missing");
  });
});
