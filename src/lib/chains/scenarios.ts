/**
 * Control chains.
 *
 * These redirect chains are hosted by this application, so their behaviour is known
 * in advance and can be used as the oracle of the test suite: every scenario below
 * states what the checker is expected to report. Public third party links change
 * without notice and are only ever used as a complement.
 */

export type HopTransform =
  | { kind: "keep" }
  | { kind: "drop"; keys: string[] }
  | { kind: "set"; key: string; value: string }
  | { kind: "duplicate"; key: string; value: string }
  | { kind: "percent-encode"; key: string }
  | { kind: "dropAll" };

export type Scenario = {
  id: string;
  title: string;
  /** What this chain does, in one line, as shown in the repository and the tests. */
  behaviour: string;
  /** What the checker is expected to report. This is the oracle. */
  expectation: string;
  hops: { status: 301 | 302 | 307 | 308; transform: HopTransform }[];
  landing: { status: number; delayMs?: number; bodyBytes?: number };
  /** Absolute destination for the last hop, instead of the landing page of the chain. */
  lastHopTo?: "loopback-honeypot" | "self";
  /** Not listed in the interface: used by the security or robustness recipe only. */
  hidden?: boolean;
};

export const DEFAULT_WITNESS_QUERY =
  "utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link";

export const SCENARIOS: Scenario[] = [
  {
    id: "preserved",
    title: "Every parameter survives",
    behaviour: "Three redirects, query string forwarded untouched.",
    expectation: "3 redirects, no parameter removed, changed, added or duplicated, final status 200.",
    hops: [
      { status: 301, transform: { kind: "keep" } },
      { status: 302, transform: { kind: "keep" } },
      { status: 302, transform: { kind: "keep" } },
    ],
    landing: { status: 200 },
  },
  {
    id: "dropped",
    title: "One parameter is dropped",
    behaviour: "Redirect 2 forwards the query string without utm_content.",
    expectation: "utm_content removed at redirect 2, missing at the final destination.",
    hops: [
      { status: 302, transform: { kind: "keep" } },
      { status: 302, transform: { kind: "drop", keys: ["utm_content"] } },
    ],
    landing: { status: 200 },
  },
  {
    id: "changed",
    title: "One value is rewritten",
    behaviour: "Redirect 2 replaces the campaign value with a fixed one.",
    expectation: "utm_campaign changed at redirect 2, spring-sale to summer-sale.",
    hops: [
      { status: 302, transform: { kind: "keep" } },
      { status: 302, transform: { kind: "set", key: "utm_campaign", value: "summer-sale" } },
    ],
    landing: { status: 200 },
  },
  {
    id: "duplicated",
    title: "A key is repeated",
    behaviour: "Redirect 1 appends a second utm_source instead of replacing it.",
    expectation: "utm_source duplicated at redirect 1, two values at the final destination.",
    hops: [
      { status: 302, transform: { kind: "duplicate", key: "utm_source", value: "partner" } },
      { status: 302, transform: { kind: "keep" } },
    ],
    landing: { status: 200 },
  },
  {
    id: "restored",
    title: "A parameter leaves and comes back",
    behaviour: "Redirect 1 drops utm_medium, redirect 2 puts the same value back.",
    expectation:
      "utm_medium absent between redirect 1 and redirect 2, present again at the final destination: the final state alone would not show the gap.",
    hops: [
      { status: 302, transform: { kind: "drop", keys: ["utm_medium"] } },
      { status: 302, transform: { kind: "set", key: "utm_medium", value: "email" } },
    ],
    landing: { status: 200 },
  },
  {
    id: "reencoded",
    title: "Same value, different encoding",
    behaviour:
      "One redirect, which writes the campaign value fully percent encoded. Only one hop, because the server that answers these chains normalises an incoming query string and would undo the difference at the next hop.",
    expectation:
      "utm_campaign not reported as changed: the decoded value is identical, the encoding difference is reported on its own line.",
    hops: [{ status: 302, transform: { kind: "percent-encode", key: "utm_campaign" } }],
    landing: { status: 200 },
  },
  {
    id: "stripped",
    title: "The query string is gone",
    behaviour: "Redirect 1 forwards to a destination with no query string at all.",
    expectation: "Every submitted parameter removed at redirect 1, none at the final destination.",
    hops: [{ status: 302, transform: { kind: "dropAll" } }],
    landing: { status: 200 },
  },
  {
    id: "loop",
    title: "A redirect loop",
    behaviour: "The first hop redirects to itself.",
    expectation: "Chain stopped at the hop limit, reported as a loop, no final destination.",
    hops: [{ status: 302, transform: { kind: "keep" } }],
    lastHopTo: "self",
    landing: { status: 200 },
  },
  {
    id: "broken",
    title: "The destination is gone",
    behaviour: "Two redirects then a destination answering 404.",
    expectation: "Chain completed, final status 404, parameters preserved up to a dead page.",
    hops: [
      { status: 302, transform: { kind: "keep" } },
      { status: 302, transform: { kind: "keep" } },
    ],
    landing: { status: 404 },
  },
  {
    id: "slow",
    title: "A slow destination",
    behaviour: "The destination waits two seconds before answering.",
    expectation: "With a shorter time budget, the scan is aborted and reported as a timeout.",
    hops: [{ status: 302, transform: { kind: "keep" } }],
    landing: { status: 200, delayMs: 2000 },
    hidden: true,
  },
  {
    id: "oversized",
    title: "An oversized destination",
    behaviour: "The destination streams more bytes than the reader accepts.",
    expectation: "Reading stops at the byte cap, the response is marked truncated, the scan still returns.",
    hops: [{ status: 302, transform: { kind: "keep" } }],
    landing: { status: 200, bodyBytes: 1_500_000 },
    hidden: true,
  },
  {
    id: "private-hop",
    title: "A redirect to a private address",
    behaviour: "The first hop redirects to a loopback address on the machine running the checker.",
    expectation: "The scan is refused at that hop and no connection is opened to the private address.",
    hops: [{ status: 302, transform: { kind: "keep" } }],
    lastHopTo: "loopback-honeypot",
    landing: { status: 200 },
    hidden: true,
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function publicScenarios(): Scenario[] {
  return SCENARIOS.filter((s) => !s.hidden);
}

/** Ordered key/value pairs of a query string, duplicates preserved. */
export function parsePairs(query: string): [string, string][] {
  const out: [string, string][] = [];
  for (const chunk of query.replace(/^\?/, "").split("&")) {
    if (!chunk) continue;
    const eq = chunk.indexOf("=");
    const rawKey = eq === -1 ? chunk : chunk.slice(0, eq);
    const rawValue = eq === -1 ? "" : chunk.slice(eq + 1);
    out.push([rawKey, rawValue]);
  }
  return out;
}

function encodeRaw(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/** Applies one hop transform to the raw pairs of a query string. */
export function applyTransform(pairs: [string, string][], t: HopTransform): [string, string][] {
  switch (t.kind) {
    case "keep":
      return pairs.slice();
    case "dropAll":
      return [];
    case "drop":
      return pairs.filter(([k]) => !t.keys.includes(decodeURIComponent(k)));
    case "set": {
      let seen = false;
      const next = pairs.map(([k, v]): [string, string] => {
        if (decodeURIComponent(k) === t.key) {
          seen = true;
          return [k, encodeRaw(t.value)];
        }
        return [k, v];
      });
      if (!seen) next.push([encodeRaw(t.key), encodeRaw(t.value)]);
      return next;
    }
    case "duplicate":
      return [...pairs, [encodeRaw(t.key), encodeRaw(t.value)]];
    case "percent-encode":
      return pairs.map(([k, v]): [string, string] => {
        if (decodeURIComponent(k) !== t.key) return [k, v];
        const decoded = decodeURIComponent(v.replace(/\+/g, " "));
        const encoded = Array.from(decoded)
          .map((char) =>
            Array.from(new TextEncoder().encode(char))
              .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
              .join(""),
          )
          .join("");
        return [k, encoded];
      });
  }
}

export function serializePairs(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
}
