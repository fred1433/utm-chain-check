import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { followChain, nodeOpenRequest, nodeResolve, type FollowDeps, type RequestSpec } from "@/lib/net/follow";
import { DEFAULT_POLICY, policyFromEnv, type Policy } from "@/lib/net/policy";
import { startHoneypot, startServer, type Honeypot, type TestServer } from "./helpers/server";

/**
 * The security recipe.
 *
 * Every case here blocks delivery. For the cases that must be refused, the proof
 * is not the checker's own report: a real listener records the connections it
 * receives and has to stay at zero, and every request the checker opens is
 * recorded next to it.
 */

let server: TestServer;
let honeypot: Honeypot;
const report: { case: string; verdict: string }[] = [];

function recordingDeps(attempts: RequestSpec[]): FollowDeps {
  return {
    resolve: nodeResolve,
    openRequest: (spec) => {
      attempts.push(spec);
      return nodeOpenRequest(spec);
    },
  };
}

function localPolicy(extra: Partial<Policy> = {}): Policy {
  return {
    ...policyFromEnv({ UTM_CHAIN_CHECK_ALLOWLIST: `127.0.0.1:${server.port}` }),
    ...extra,
  };
}

beforeAll(async () => {
  server = await startServer();
  honeypot = await startHoneypot();
}, 120_000);

afterAll(async () => {
  await server?.stop();
  await honeypot?.stop();
  // eslint-disable-next-line no-console
  console.log(
    ["", "Security recipe", ...report.map((r) => `  ${r.case}: ${r.verdict}`), ""].join("\n"),
  );
});

describe("the security recipe that blocks delivery", () => {
  it("refuses a private destination submitted directly, and opens no connection to it", async () => {
    const attempts: RequestSpec[] = [];
    const before = honeypot.connections;
    // On a port the checker follows, the refusal comes from the address itself.
    const onPort80 = await followChain("http://127.0.0.1/", DEFAULT_POLICY, recordingDeps(attempts));
    expect(onPort80.outcome).toBe("refused");
    expect(onPort80.reason).toMatch(/loopback/);

    // On any other port, the port rule refuses even earlier.
    const onHoneypotPort = await followChain(
      `http://127.0.0.1:${honeypot.port}/`,
      DEFAULT_POLICY,
      recordingDeps(attempts),
    );
    expect(onHoneypotPort.outcome).toBe("refused");
    expect(onHoneypotPort.reason).toMatch(/port/);

    expect(attempts).toHaveLength(0);
    expect(honeypot.connections).toBe(before);
    report.push({ case: "private destination submitted directly", verdict: "refused, 0 connections" });
  });

  it("refuses a redirect towards a forbidden destination, and opens no connection to it", async () => {
    const attempts: RequestSpec[] = [];
    const before = honeypot.connections;
    const result = await followChain(
      `http://127.0.0.1:${server.port}/c/private-hop/0?honeypot_port=${honeypot.port}&utm_source=x`,
      localPolicy(),
      recordingDeps(attempts),
    );
    expect(result.outcome).toBe("refused");
    expect(result.refusedUrl).toBe(`http://127.0.0.1:${honeypot.port}/`);
    expect(attempts.some((spec) => spec.port === honeypot.port)).toBe(false);
    expect(honeypot.connections).toBe(before);
    report.push({ case: "redirect towards a forbidden destination", verdict: "refused at that hop, 0 connections" });
  });

  it("refuses the IPv6 spellings of a local address", async () => {
    for (const link of [
      `http://[::1]:${honeypot.port}/`,
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
    ]) {
      const attempts: RequestSpec[] = [];
      const result = await followChain(link, DEFAULT_POLICY, recordingDeps(attempts));
      expect(result.outcome).toBe("refused");
      expect(attempts).toHaveLength(0);
    }
    expect(honeypot.connections).toBe(0);
    report.push({ case: "IPv6 spellings of a local address", verdict: "refused, 0 connections" });
  });

  it("connects to the address it validated, and does not resolve the name a second time", async () => {
    const resolutions: string[] = [];
    const opened: RequestSpec[] = [];
    let call = 0;
    const deps: FollowDeps = {
      resolve: async (hostname) => {
        resolutions.push(hostname);
        call += 1;
        // A name that answers with a public address while it is being checked and
        // with a loopback address a moment later.
        return call === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
      },
      openRequest: async (spec) => {
        opened.push(spec);
        return { status: 200, location: null, contentType: "text/html", bytesRead: 10, truncated: false };
      },
    };

    const result = await followChain("https://rebinding.example/offer?utm_source=x", DEFAULT_POLICY, deps);
    expect(result.outcome).toBe("completed");
    expect(resolutions).toEqual(["rebinding.example"]);
    expect(opened).toHaveLength(1);
    expect(opened[0].ip).toBe("93.184.216.34");
    expect(opened[0].hostname).toBe("rebinding.example");
    report.push({ case: "address changed after validation", verdict: "connected to the validated address only" });
  });

  it("stops a chain that sends the visitor round in circles", async () => {
    const result = await followChain(
      `http://127.0.0.1:${server.port}/c/loop/0?utm_source=x`,
      localPolicy(),
      recordingDeps([]),
    );
    expect(result.outcome).toBe("loop");
    expect(result.hops.length).toBeLessThanOrEqual(DEFAULT_POLICY.maxHops);
    report.push({ case: "redirect loop", verdict: `stopped after ${result.hops.length} hops` });
  });

  it("stops a chain that never ends, at the hop limit", async () => {
    const deps: FollowDeps = {
      resolve: async () => ["93.184.216.34"],
      openRequest: async (spec) => {
        const step = Number(/\/(\d+)$/.exec(spec.path)?.[1] ?? "0");
        return {
          status: 302,
          location: `/step/${step + 1}`,
          contentType: null,
          bytesRead: 0,
          truncated: false,
        };
      },
    };
    const result = await followChain("https://endless.example/step/0", DEFAULT_POLICY, deps);
    expect(result.outcome).toBe("hop_limit");
    expect(result.hops).toHaveLength(DEFAULT_POLICY.maxHops);
    report.push({ case: "endless chain", verdict: `stopped at ${DEFAULT_POLICY.maxHops} hops` });
  });

  it("aborts a slow destination instead of waiting for it", async () => {
    const started = Date.now();
    const result = await followChain(
      `http://127.0.0.1:${server.port}/c/slow/0?utm_source=x`,
      localPolicy({ totalBudgetMs: 700, perRequestMs: 700 }),
      recordingDeps([]),
    );
    const elapsed = Date.now() - started;
    expect(result.outcome).toBe("timeout");
    expect(elapsed).toBeLessThan(1800);
    report.push({ case: "slow destination", verdict: `aborted after ${elapsed} ms` });
  });

  it("stops reading an oversized destination at the byte cap", async () => {
    const result = await followChain(
      `http://127.0.0.1:${server.port}/c/oversized/0?utm_source=x`,
      localPolicy({ maxResponseBytes: 32_768 }),
      recordingDeps([]),
    );
    expect(result.outcome).toBe("completed");
    const last = result.hops[result.hops.length - 1];
    expect(last.truncated).toBe(true);
    report.push({ case: "oversized destination", verdict: "reading stopped at the byte cap" });
  });

  it("sends no cookie and no header of the visitor towards the destination", async () => {
    const seen: RequestSpec[] = [];
    const deps: FollowDeps = {
      resolve: async () => ["93.184.216.34"],
      openRequest: async (spec) => {
        seen.push(spec);
        return { status: 200, location: null, contentType: null, bytesRead: 0, truncated: false };
      },
    };
    await followChain("https://example.com/offer", DEFAULT_POLICY, deps);
    expect(Object.keys(seen[0])).not.toContain("headers");
    expect(seen[0].path).toBe("/offer");
    report.push({ case: "visitor headers and cookies", verdict: "never part of the outbound request" });
  });
});
