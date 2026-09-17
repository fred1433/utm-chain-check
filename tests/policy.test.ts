import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, checkUrlShape, isAllowlisted, parseAllowlist, policyFromEnv } from "@/lib/net/policy";

describe("what a submitted link has to look like", () => {
  it("accepts an ordinary http and https link", () => {
    expect(checkUrlShape("https://example.com/offer?utm_source=x", DEFAULT_POLICY).ok).toBe(true);
    expect(checkUrlShape("http://example.com/offer", DEFAULT_POLICY).ok).toBe(true);
  });

  const refused = [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com/",
    "data:text/html,<script>",
    "javascript:alert(1)",
    "https://user:secret@example.com/",
    "https://example.com:22/",
    "https://example.com:6379/",
    "not a link",
    "",
  ];
  for (const link of refused) {
    it(`refuses ${link || "an empty submission"}`, () => {
      expect(checkUrlShape(link, DEFAULT_POLICY).ok).toBe(false);
    });
  }

  it("keeps the default ports only", () => {
    expect(DEFAULT_POLICY.allowedPorts).toEqual([80, 443]);
    expect(checkUrlShape("http://example.com:8080/", DEFAULT_POLICY).ok).toBe(false);
  });

  it("reads an operator allowlist and opens its ports, and nothing else", () => {
    const policy = policyFromEnv({ UTM_CHAIN_CHECK_ALLOWLIST: "127.0.0.1:3100, staging.example.com" });
    expect(policy.allowedPorts).toContain(3100);
    const local = checkUrlShape("http://127.0.0.1:3100/c/preserved/0", policy);
    expect(local.ok).toBe(true);
    if (local.ok) expect(isAllowlisted(local.url, policy)).toBe(true);

    const other = checkUrlShape("http://127.0.0.1:9000/", policy);
    expect(other.ok).toBe(false);

    const elsewhere = checkUrlShape("https://example.com/", policy);
    expect(elsewhere.ok).toBe(true);
    if (elsewhere.ok) expect(isAllowlisted(elsewhere.url, policy)).toBe(false);
  });

  it("has an empty allowlist when the operator sets nothing", () => {
    expect(policyFromEnv({ }).allowlist).toEqual([]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});
