import { describe, expect, it } from "vitest";
import { analyzeChain, isCampaignParam, paramsOf } from "@/lib/utm/diff";

const base = "https://example.com/offer";

describe("how values are compared", () => {
  it("does not call a different encoding of the same value a change", () => {
    const analysis = analyzeChain([
      `${base}?utm_campaign=spring+sale`,
      `${base}?utm_campaign=spring%20sale`,
    ]);
    expect(analysis.transitions[0].changes[0].type).toBe("reencoded");
    expect(analysis.verdicts[0].status).toBe("reencoded");
    expect(analysis.counts.modified).toBe(0);
  });

  it("calls a different value a change, and says which values", () => {
    const analysis = analyzeChain([`${base}?utm_campaign=spring`, `${base}?utm_campaign=summer`]);
    expect(analysis.transitions[0].changes[0]).toMatchObject({
      type: "modified",
      key: "utm_campaign",
      before: ["spring"],
      after: ["summer"],
    });
  });

  it("separates a key that is repeated from a key that is replaced", () => {
    const duplicated = analyzeChain([`${base}?utm_source=a`, `${base}?utm_source=a&utm_source=b`]);
    expect(duplicated.transitions[0].changes[0].type).toBe("duplicated");
    expect(duplicated.verdicts[0].final).toEqual(["a", "b"]);

    const collapsed = analyzeChain([`${base}?utm_source=a&utm_source=b`, `${base}?utm_source=b`]);
    expect(collapsed.transitions[0].changes[0].type).toBe("collapsed");
  });

  it("reports what was added along the way", () => {
    const analysis = analyzeChain([`${base}?utm_source=a`, `${base}?utm_source=a&gclid=123`]);
    expect(analysis.transitions[0].changes[0]).toMatchObject({ type: "added", key: "gclid" });
    expect(analysis.verdicts.find((v) => v.key === "gclid")?.status).toBe("added");
  });

  it("keeps the two readings apart: what happened at each hop, and what is left at the end", () => {
    const analysis = analyzeChain([
      `${base}?utm_medium=email`,
      `${base}`,
      `${base}?utm_medium=email`,
    ]);
    const verdict = analysis.verdicts[0];
    expect(verdict.status).toBe("preserved");
    expect(verdict.absentInTransit).toBe(true);
    expect(analysis.transitions[0].changes[0].type).toBe("removed");
    expect(analysis.transitions[1].changes[0].type).toBe("added");
  });

  it("does not confuse the name of a parameter with its value", () => {
    const analysis = analyzeChain([`${base}?utm_campaign=spring`, `${base}?utm_campaign=`]);
    expect(analysis.verdicts[0].status).toBe("changed");
    expect(analysis.verdicts[0].final).toEqual([""]);
  });

  it("reads a query string the way a collector reads it", () => {
    const params = paramsOf(`${base}?a=1&a=2&b=&c`);
    expect(params.find((p) => p.key === "a")?.values).toEqual(["1", "2"]);
    expect(params.find((p) => p.key === "b")?.values).toEqual([""]);
    expect(params.find((p) => p.key === "c")?.values).toEqual([""]);
  });

  it("ignores the fragment, which never reaches a server", () => {
    const analysis = analyzeChain([`${base}?utm_source=a#section`, `${base}?utm_source=a`]);
    expect(analysis.transitions[0].changes).toHaveLength(0);
  });

  it("knows a campaign parameter from an ordinary one", () => {
    expect(isCampaignParam("utm_source")).toBe(true);
    expect(isCampaignParam("UTM_Source")).toBe(true);
    expect(isCampaignParam("gclid")).toBe(true);
    expect(isCampaignParam("fbclid")).toBe(true);
    expect(isCampaignParam("page")).toBe(false);
  });

  it("sorts campaign parameters first so the answer is readable", () => {
    const analysis = analyzeChain([`${base}?page=2&utm_source=a`]);
    expect(analysis.verdicts.map((v) => v.key)).toEqual(["utm_source", "page"]);
  });
});
