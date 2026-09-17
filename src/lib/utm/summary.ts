import type { ChainAnalysis, ParamVerdict } from "./diff";
import type { FollowResult } from "@/lib/net/follow";

export const LIMITS = [
  "A link with no campaign parameter is not a pass. Witness values can be added on purpose, and a run that uses them says so.",
  "The HTTP chain is not the whole journey. Redirects done in JavaScript, signed in flows and cookie based routing are out of scope.",
  "Parameters kept in the URL is not attribution validated. Your analytics property can still drop, rename or transform them.",
];

function listValues(values: string[] | null): string {
  if (!values || values.length === 0) return "empty";
  return values.join(", ");
}

function describe(verdict: ParamVerdict): string | null {
  const at = verdict.firstChangeAt;
  const where = at ? ` at redirect ${at}` : "";
  switch (verdict.status) {
    case "missing":
      return `${verdict.key} removed${where}, absent from the final destination.`;
    case "changed":
      return `${verdict.key} changed${where}: ${listValues(verdict.submitted)} to ${listValues(
        verdict.final,
      )}.`;
    case "duplicated":
      return `${verdict.key} duplicated${where}: ${listValues(verdict.final)} at the final destination.`;
    case "reencoded":
      return `${verdict.key} kept its value${where}, written with a different encoding.`;
    case "added":
      return `${verdict.key} added${where}: ${listValues(verdict.final)}.`;
    default:
      return null;
  }
}

export function summarize(follow: FollowResult, analysis: ChainAnalysis): string[] {
  const lines: string[] = [];
  const redirects = Math.max(0, follow.urls.length - 1);

  switch (follow.outcome) {
    case "completed":
      lines.push(
        redirects === 0
          ? "HTTP chain completed: no redirect, the submitted link answered directly."
          : `HTTP chain completed: ${redirects} ${redirects === 1 ? "redirect" : "redirects"}.`,
      );
      break;
    case "loop":
      lines.push(`HTTP chain stopped after ${redirects} redirects: ${follow.reason}`);
      break;
    case "hop_limit":
      lines.push(`HTTP chain stopped: ${follow.reason}`);
      break;
    case "timeout":
      lines.push(`HTTP chain stopped: ${follow.reason}`);
      break;
    case "refused":
      lines.push(`Scan refused: ${follow.reason}.`);
      return lines.concat("Nothing was requested from that destination.");
    default:
      lines.push(`HTTP chain stopped: ${follow.reason}`);
  }

  const campaign = analysis.verdicts.filter((v) => v.campaign);
  if (campaign.length === 0) {
    lines.push("No campaign parameter was submitted, so nothing could be preserved. This is not a pass.");
  } else {
    const settled = follow.outcome === "completed";
    const preserved = campaign.filter((v) => v.status === "preserved").map((v) => v.key);
    const notable = campaign.filter((v) => v.status !== "preserved");
    if (preserved.length > 0) {
      lines.push(
        settled
          ? `${preserved.join(", ")} preserved.`
          : `${preserved.join(", ")} unchanged up to the hop where the chain stopped.`,
      );
    }
    const described = notable.map(describe).filter((l): l is string => l !== null);
    for (const line of described.slice(0, 3)) lines.push(line);
    if (described.length > 3) {
      const rest = described.length - 3;
      lines.push(
        `${rest} more campaign ${rest === 1 ? "parameter" : "parameters"} changed, listed hop by hop below.`,
      );
    }
    const returning = campaign.filter((v) => v.absentInTransit);
    if (returning.length > 0) {
      lines.push(
        `${returning.map((v) => v.key).join(", ")} absent from an intermediate hop and present again at the end.`,
      );
    }
  }

  if (follow.outcome === "completed" && follow.finalStatus !== null) {
    lines.push(`Final destination responded with HTTP ${follow.finalStatus}.`);
  }
  lines.push("Analytics attribution not checked.");
  return lines;
}
