/**
 * Follows a redirect chain, one hop at a time.
 *
 * Automatic following is off. Every Location header is resolved, then judged again
 * from scratch, then connected to at the address that was just validated, with no
 * second name resolution. The host name and the TLS identity check keep using the
 * name, so certificates are still verified against the name the user submitted.
 */

import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { classifyAddressText, parseIp } from "./address";
import { checkUrlShape, effectivePort, isAllowlisted, type Policy } from "./policy";

export const USER_AGENT = "UTMChainCheck/1.0 (+https://utm-chain-check.theaipipe.com)";

export type RequestSpec = {
  protocol: string;
  hostname: string;
  ip: string;
  port: number;
  path: string;
  timeoutMs: number;
  maxHeaderBytes: number;
  maxResponseBytes: number;
};

export type RawResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  bytesRead: number;
  truncated: boolean;
};

export type FollowDeps = {
  resolve: (hostname: string) => Promise<string[]>;
  openRequest: (spec: RequestSpec) => Promise<RawResponse>;
};

export type Hop = {
  index: number;
  url: string;
  status: number | null;
  redirectKind: "permanent" | "temporary" | null;
  location: string | null;
  elapsedMs: number;
  truncated?: boolean;
};

export type FollowOutcome =
  | "completed"
  | "hop_limit"
  | "loop"
  | "timeout"
  | "refused"
  | "network_error";

export type FollowResult = {
  outcome: FollowOutcome;
  reason: string | null;
  /** The URL at every step, the submitted one first, the final destination last. */
  urls: string[];
  hops: Hop[];
  finalStatus: number | null;
  totalMs: number;
  /** Set when a hop was refused: the destination that was never contacted. */
  refusedUrl?: string;
};

export function nodeResolve(hostname: string): Promise<string[]> {
  const literal = parseIp(hostname.replace(/^\[|\]$/g, ""));
  if (literal) return Promise.resolve([hostname.replace(/^\[|\]$/g, "")]);
  return dnsLookup(hostname, { all: true, verbatim: true }).then((entries) =>
    entries.map((e) => e.address),
  );
}

export function nodeOpenRequest(spec: RequestSpec): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const isHttps = spec.protocol === "https:";
    const mod = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;
    const hostHeader =
      spec.port === defaultPort ? spec.hostname : `${spec.hostname}:${spec.port}`;

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      fn();
    };

    const request = mod.request(
      {
        // The connection target is the address that was just validated. Passing an
        // address literal here means no second name resolution happens.
        host: spec.ip,
        port: spec.port,
        path: spec.path,
        method: "GET",
        setHost: false,
        agent: false,
        maxHeaderSize: spec.maxHeaderBytes,
        ...(isHttps ? { servername: spec.hostname, rejectUnauthorized: true } : {}),
        headers: {
          host: hostHeader,
          "user-agent": USER_AGENT,
          accept: "*/*",
          "accept-encoding": "identity",
          connection: "close",
        },
      },
      (res) => {
        let bytesRead = 0;
        let truncated = false;
        const status = res.statusCode ?? 0;
        const locationHeader = res.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader ?? null;
        const contentTypeHeader = res.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : contentTypeHeader ?? null;

        const done = () =>
          finish(() => resolve({ status, location, contentType, bytesRead, truncated }));

        if (location) {
          // Nothing else is needed from a redirect: drop the connection at once.
          res.destroy();
          request.destroy();
          done();
          return;
        }

        res.on("data", (chunk: Buffer) => {
          bytesRead += chunk.length;
          if (bytesRead >= spec.maxResponseBytes) {
            truncated = true;
            res.destroy();
            request.destroy();
            done();
          }
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => done());
      },
    );

    const hardTimer = setTimeout(() => {
      finish(() => {
        request.destroy();
        const error = new Error("time budget exceeded");
        (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
        reject(error);
      });
    }, spec.timeoutMs);

    request.setTimeout(spec.timeoutMs, () => {
      request.destroy();
    });
    request.on("error", (error) => finish(() => reject(error)));
    request.end();
  });
}

export const nodeDeps: FollowDeps = {
  resolve: nodeResolve,
  openRequest: nodeOpenRequest,
};

function redirectKind(status: number): "permanent" | "temporary" | null {
  if (status === 301 || status === 308) return "permanent";
  if (status === 302 || status === 303 || status === 307) return "temporary";
  return null;
}

async function validateAddress(
  url: URL,
  policy: Policy,
  deps: FollowDeps,
): Promise<{ ok: true; ip: string } | { ok: false; reason: string }> {
  if (isAllowlisted(url, policy)) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const literal = parseIp(hostname);
    if (literal) return { ok: true, ip: hostname };
    const addresses = await deps.resolve(hostname);
    if (addresses.length === 0) return { ok: false, reason: "host does not resolve" };
    return { ok: true, ip: addresses[0] };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = await deps.resolve(hostname);
  } catch {
    return { ok: false, reason: "host does not resolve" };
  }
  if (addresses.length === 0) return { ok: false, reason: "host does not resolve" };

  for (const address of addresses) {
    const verdict = classifyAddressText(address);
    if (!verdict.allowed) {
      return { ok: false, reason: `destination resolves to a ${verdict.reason}` };
    }
  }
  return { ok: true, ip: addresses[0] };
}

export async function followChain(
  submitted: string,
  policy: Policy,
  deps: FollowDeps = nodeDeps,
): Promise<FollowResult> {
  const startedAt = Date.now();
  const hops: Hop[] = [];
  const urls: string[] = [];
  const seen = new Set<string>();

  const shape = checkUrlShape(submitted, policy);
  if (!shape.ok) {
    return {
      outcome: "refused",
      reason: shape.reason,
      urls: [],
      hops: [],
      finalStatus: null,
      totalMs: Date.now() - startedAt,
      refusedUrl: submitted.trim().slice(0, 256),
    };
  }

  let current: URL = shape.url;
  urls.push(current.toString());

  for (let index = 0; index < policy.maxHops; index += 1) {
    const elapsed = Date.now() - startedAt;
    const remaining = policy.totalBudgetMs - elapsed;
    if (remaining <= 0) {
      return {
        outcome: "timeout",
        reason: "the time budget for the whole chain was used up",
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
      };
    }

    const address = await validateAddress(current, policy, deps);
    if (!address.ok) {
      return {
        outcome: "refused",
        reason: address.reason,
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
        refusedUrl: current.toString(),
      };
    }

    const hopStartedAt = Date.now();
    let response: RawResponse;
    try {
      response = await deps.openRequest({
        protocol: current.protocol,
        hostname: current.hostname.replace(/^\[|\]$/g, ""),
        ip: address.ip,
        port: effectivePort(current),
        path: `${current.pathname}${current.search}`,
        timeoutMs: Math.min(policy.perRequestMs, remaining),
        maxHeaderBytes: policy.maxHeaderBytes,
        maxResponseBytes: policy.maxResponseBytes,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const timedOut = code === "ETIMEDOUT" || code === "ECONNABORTED";
      hops.push({
        index,
        url: current.toString(),
        status: null,
        redirectKind: null,
        location: null,
        elapsedMs: Date.now() - hopStartedAt,
      });
      return {
        outcome: timedOut ? "timeout" : "network_error",
        reason: timedOut
          ? "the destination did not answer within the time budget"
          : `the destination could not be reached (${code ?? "network error"})`,
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
      };
    }

    const kind = redirectKind(response.status);
    hops.push({
      index,
      url: current.toString(),
      status: response.status,
      redirectKind: kind,
      location: response.location,
      elapsedMs: Date.now() - hopStartedAt,
      ...(response.truncated ? { truncated: true } : {}),
    });

    if (!response.location || !kind) {
      return {
        outcome: "completed",
        reason: null,
        urls,
        hops,
        finalStatus: response.status,
        totalMs: Date.now() - startedAt,
      };
    }

    let next: URL;
    try {
      next = new URL(response.location, current);
    } catch {
      return {
        outcome: "network_error",
        reason: "the destination sent a redirect that is not a usable link",
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
      };
    }

    const nextShape = checkUrlShape(next.toString(), policy);
    if (!nextShape.ok) {
      return {
        outcome: "refused",
        reason: nextShape.reason,
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
        refusedUrl: next.toString(),
      };
    }

    const key = next.toString();
    if (seen.has(key)) {
      urls.push(key);
      return {
        outcome: "loop",
        reason: "this chain sends the visitor back to a link it already used",
        urls,
        hops,
        finalStatus: null,
        totalMs: Date.now() - startedAt,
      };
    }
    seen.add(current.toString());
    current = nextShape.url;
    urls.push(current.toString());
  }

  return {
    outcome: "hop_limit",
    reason: `the chain was still redirecting after ${policy.maxHops} hops`,
    urls,
    hops,
    finalStatus: null,
    totalMs: Date.now() - startedAt,
  };
}
