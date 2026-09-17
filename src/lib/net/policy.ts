/**
 * What the checker is allowed to request.
 *
 * Everything here is a refusal rule. The deployed instance runs with an empty
 * allowlist: a test asserts that with the default policy a private destination is
 * refused and no connection is opened. An operator who self hosts can name origins
 * explicitly, which is the only way a private destination is ever reachable.
 */

export type AllowlistEntry = { host: string; port: number | null };

export type Policy = {
  allowedProtocols: string[];
  allowedPorts: number[];
  allowlist: AllowlistEntry[];
  maxHops: number;
  totalBudgetMs: number;
  perRequestMs: number;
  maxResponseBytes: number;
  maxHeaderBytes: number;
};

export const DEFAULT_POLICY: Policy = {
  allowedProtocols: ["http:", "https:"],
  allowedPorts: [80, 443],
  allowlist: [],
  maxHops: 10,
  totalBudgetMs: 12_000,
  perRequestMs: 5_000,
  maxResponseBytes: 65_536,
  maxHeaderBytes: 16_384,
};

export function parseAllowlist(raw: string | undefined): AllowlistEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const withoutScheme = entry.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const match = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(withoutScheme);
      if (!match) return null;
      const host = match[1].replace(/^\[|\]$/g, "").toLowerCase();
      const port = match[2] ? Number(match[2]) : null;
      return { host, port };
    })
    .filter((e): e is AllowlistEntry => e !== null);
}

export type PolicyEnv = { UTM_CHAIN_CHECK_ALLOWLIST?: string };

export function policyFromEnv(env: PolicyEnv = process.env as PolicyEnv): Policy {
  const allowlist = parseAllowlist(env.UTM_CHAIN_CHECK_ALLOWLIST);
  const extraPorts = allowlist
    .map((e) => e.port)
    .filter((p): p is number => typeof p === "number");
  return {
    ...DEFAULT_POLICY,
    allowlist,
    allowedPorts: [...new Set([...DEFAULT_POLICY.allowedPorts, ...extraPorts])],
  };
}

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

export function checkUrlShape(raw: string, policy: Policy): UrlVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "no link submitted" };
  if (trimmed.length > 2048) return { ok: false, reason: "link longer than 2048 characters" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "link could not be parsed, an absolute http or https link is expected" };
  }

  if (!policy.allowedProtocols.includes(url.protocol)) {
    return { ok: false, reason: `scheme ${url.protocol.replace(":", "")} is not followed, http and https only` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "links carrying credentials are refused" };
  }
  if (!url.hostname) {
    return { ok: false, reason: "link has no host" };
  }

  const port = effectivePort(url);
  if (!policy.allowedPorts.includes(port)) {
    return { ok: false, reason: `port ${port} is not followed` };
  }
  return { ok: true, url };
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export function isAllowlisted(url: URL, policy: Policy): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = effectivePort(url);
  return policy.allowlist.some((e) => e.host === host && (e.port === null || e.port === port));
}
