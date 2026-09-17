/**
 * What happened to the campaign parameters along the chain.
 *
 * Two readings, because one is not enough: how the parameters change at each hop,
 * and what is left at the final destination. A parameter can disappear and come
 * back, and keeping the name is not keeping the value.
 */

export const CLICK_IDS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "epik",
  "irclickid",
  "mc_eid",
  "_hsenc",
];

export function isCampaignParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || CLICK_IDS.includes(lower);
}

export type ParamSnapshot = { key: string; values: string[]; raws: string[] };
export type StepParams = { index: number; url: string; params: ParamSnapshot[] };

export type Change =
  | { type: "removed"; key: string; before: string[] }
  | { type: "added"; key: string; after: string[] }
  | { type: "modified"; key: string; before: string[]; after: string[] }
  | { type: "duplicated"; key: string; before: string[]; after: string[] }
  | { type: "collapsed"; key: string; before: string[]; after: string[] }
  | { type: "reencoded"; key: string; value: string[]; beforeRaw: string[]; afterRaw: string[] };

export type Transition = { at: number; changes: Change[] };

export type ParamVerdict = {
  key: string;
  campaign: boolean;
  status: "preserved" | "changed" | "missing" | "duplicated" | "reencoded" | "added";
  submitted: string[] | null;
  final: string[] | null;
  /** True when the parameter was absent at some point and present at the end. */
  absentInTransit: boolean;
  /** Hop index of the transition that first changed this parameter. */
  firstChangeAt: number | null;
};

export type ChainAnalysis = {
  steps: StepParams[];
  transitions: Transition[];
  verdicts: ParamVerdict[];
  counts: { removed: number; modified: number; added: number; duplicated: number; reencoded: number };
};

/**
 * Value comparison policy, stated once and applied everywhere: values are compared
 * after percent decoding, with a plus sign read as a space, which is what a browser
 * and an analytics collector do with a query string. Two values whose decoding is
 * identical are not a change, they are an encoding difference, and they are reported
 * as such.
 */
export function decodeValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

export function paramsOf(url: string): ParamSnapshot[] {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const hashIndex = query.indexOf("#");
  const clean = hashIndex === -1 ? query : query.slice(0, hashIndex);
  const byKey = new Map<string, ParamSnapshot>();
  for (const chunk of clean.split("&")) {
    if (!chunk) continue;
    const eq = chunk.indexOf("=");
    const rawKey = eq === -1 ? chunk : chunk.slice(0, eq);
    const rawValue = eq === -1 ? "" : chunk.slice(eq + 1);
    const key = decodeValue(rawKey);
    const entry = byKey.get(key) ?? { key, values: [], raws: [] };
    entry.values.push(decodeValue(rawValue));
    entry.raws.push(rawValue);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function diffStep(before: ParamSnapshot[], after: ParamSnapshot[]): Change[] {
  const changes: Change[] = [];
  const beforeMap = new Map(before.map((p) => [p.key, p]));
  const afterMap = new Map(after.map((p) => [p.key, p]));

  for (const param of before) {
    const next = afterMap.get(param.key);
    if (!next) {
      changes.push({ type: "removed", key: param.key, before: param.values });
      continue;
    }
    if (sameValues(param.values, next.values)) {
      if (!sameValues(param.raws, next.raws)) {
        changes.push({
          type: "reencoded",
          key: param.key,
          value: next.values,
          beforeRaw: param.raws,
          afterRaw: next.raws,
        });
      }
      continue;
    }
    if (next.values.length > param.values.length) {
      changes.push({
        type: "duplicated",
        key: param.key,
        before: param.values,
        after: next.values,
      });
      continue;
    }
    if (next.values.length < param.values.length) {
      changes.push({
        type: "collapsed",
        key: param.key,
        before: param.values,
        after: next.values,
      });
      continue;
    }
    changes.push({ type: "modified", key: param.key, before: param.values, after: next.values });
  }

  for (const param of after) {
    if (!beforeMap.has(param.key)) {
      changes.push({ type: "added", key: param.key, after: param.values });
    }
  }
  return changes;
}

export function analyzeChain(urls: string[]): ChainAnalysis {
  const steps: StepParams[] = urls.map((url, index) => ({
    index,
    url,
    params: paramsOf(url),
  }));

  const transitions: Transition[] = [];
  for (let i = 0; i + 1 < steps.length; i += 1) {
    transitions.push({ at: i + 1, changes: diffStep(steps[i].params, steps[i + 1].params) });
  }

  const counts = { removed: 0, modified: 0, added: 0, duplicated: 0, reencoded: 0 };
  for (const transition of transitions) {
    for (const change of transition.changes) {
      if (change.type === "removed") counts.removed += 1;
      else if (change.type === "added") counts.added += 1;
      else if (change.type === "duplicated") counts.duplicated += 1;
      else if (change.type === "reencoded") counts.reencoded += 1;
      else counts.modified += 1;
    }
  }

  const first = steps[0];
  const last = steps[steps.length - 1];
  const keys = new Set<string>();
  for (const step of steps) for (const param of step.params) keys.add(param.key);

  const verdicts: ParamVerdict[] = [...keys].map((key) => {
    const submitted = first?.params.find((p) => p.key === key) ?? null;
    const final = last?.params.find((p) => p.key === key) ?? null;
    const absentInTransit = steps.some(
      (step, i) => i > 0 && i < steps.length - 1 && !step.params.some((p) => p.key === key),
    );
    const firstChange =
      transitions.find((t) => t.changes.some((c) => c.key === key))?.at ?? null;

    let status: ParamVerdict["status"];
    if (!submitted && final) status = "added";
    else if (submitted && !final) status = "missing";
    else if (submitted && final && sameValues(submitted.values, final.values)) {
      status = sameValues(submitted.raws, final.raws) ? "preserved" : "reencoded";
    } else if (submitted && final && final.values.length > submitted.values.length) {
      status = "duplicated";
    } else {
      status = "changed";
    }

    return {
      key,
      campaign: isCampaignParam(key),
      status,
      submitted: submitted ? submitted.values : null,
      final: final ? final.values : null,
      absentInTransit: absentInTransit && status !== "missing",
      firstChangeAt: firstChange,
    };
  });

  verdicts.sort((a, b) => {
    if (a.campaign !== b.campaign) return a.campaign ? -1 : 1;
    return a.key.localeCompare(b.key);
  });

  return { steps, transitions, verdicts, counts };
}
