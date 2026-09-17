import { randomUUID } from "node:crypto";
import { followChain, nodeDeps, type FollowDeps, type FollowResult } from "@/lib/net/follow";
import { policyFromEnv, type Policy } from "@/lib/net/policy";
import { analyzeChain, type ChainAnalysis } from "@/lib/utm/diff";
import { LIMITS, summarize } from "@/lib/utm/summary";

export const WITNESS_VALUES: [string, string][] = [
  ["utm_source", "chain-check"],
  ["utm_medium", "witness"],
  ["utm_campaign", "witness-run"],
  ["utm_content", "witness-a"],
];

export function withWitnessValues(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw;
  }
  for (const [key, value] of WITNESS_VALUES) {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value);
  }
  return url.toString();
}

export type ScanResult = {
  scanId: string;
  submitted: string;
  witnessValues: boolean;
  outcome: FollowResult["outcome"];
  reason: string | null;
  refusedUrl?: string;
  finalStatus: number | null;
  totalMs: number;
  hops: FollowResult["hops"];
  steps: ChainAnalysis["steps"];
  transitions: ChainAnalysis["transitions"];
  verdicts: ChainAnalysis["verdicts"];
  summary: string[];
  limits: string[];
};

export async function runScan(
  submitted: string,
  options: { witnessValues?: boolean; policy?: Policy; deps?: FollowDeps } = {},
): Promise<ScanResult> {
  const policy = options.policy ?? policyFromEnv();
  const deps = options.deps ?? nodeDeps;
  const target = options.witnessValues ? withWitnessValues(submitted) : submitted.trim();

  const follow = await followChain(target, policy, deps);
  const analysis = analyzeChain(follow.urls);

  return {
    scanId: randomUUID(),
    submitted: target,
    witnessValues: Boolean(options.witnessValues),
    outcome: follow.outcome,
    reason: follow.reason,
    ...(follow.refusedUrl ? { refusedUrl: follow.refusedUrl } : {}),
    finalStatus: follow.finalStatus,
    totalMs: follow.totalMs,
    hops: follow.hops,
    steps: analysis.steps,
    transitions: analysis.transitions,
    verdicts: analysis.verdicts,
    summary: summarize(follow, analysis),
    limits: LIMITS,
  };
}
