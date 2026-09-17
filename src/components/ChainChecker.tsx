"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanResult } from "@/lib/scan";
import type { Change, ParamVerdict } from "@/lib/utm/diff";
import { emit } from "@/lib/events/emitter";

const EXAMPLES = [
  { id: "changed", label: "a value is rewritten" },
  { id: "dropped", label: "a parameter is dropped" },
  { id: "preserved", label: "everything survives" },
] as const;

const WITNESS_QUERY =
  "utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link";

function exampleUrl(origin: string, id: string): string {
  return `${origin}/c/${id}/0?${WITNESS_QUERY}`;
}

function statusColour(status: ParamVerdict["status"]): string {
  switch (status) {
    case "preserved":
      return "text-preserved";
    case "missing":
      return "text-missing";
    default:
      return "text-altered";
  }
}

function changeLine(change: Change): string {
  switch (change.type) {
    case "removed":
      return `removed, was ${change.before.join(", ")}`;
    case "added":
      return `added, now ${change.after.join(", ")}`;
    case "modified":
      return `${change.before.join(", ")} → ${change.after.join(", ")}`;
    case "duplicated":
      return `duplicated, now ${change.after.join(", ")}`;
    case "collapsed":
      return `values merged, now ${change.after.join(", ")}`;
    case "reencoded":
      return `same value, encoding changed`;
  }
}

function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path.length > 68 ? `${path.slice(0, 68)}…` : path;
  } catch {
    return url;
  }
}

export default function ChainChecker() {
  const [origin, setOrigin] = useState("");
  const [value, setValue] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayed = useRef<string | null>(null);

  useEffect(() => {
    const current = window.location.origin;
    setOrigin(current);
    setValue(exampleUrl(current, "changed"));
    void emit("page_opened");
  }, []);

  const exampleUrls = useMemo(
    () => (origin ? EXAMPLES.map((e) => ({ ...e, url: exampleUrl(origin, e.id) })) : []),
    [origin],
  );

  const run = useCallback(
    async (target: string, witnessValues = false) => {
      if (!target.trim() || running) return;
      const isExample = exampleUrls.some((e) => e.url === target.trim());
      setRunning(true);
      setError(null);
      void emit("scan_started", { isExample });
      try {
        const response = await fetch("/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: target, witnessValues }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setResult(null);
          setError(typeof payload?.error === "string" ? payload.error : "the scan could not be completed");
          return;
        }
        setResult(payload as ScanResult);
        void emit("scan_result_computed", { scanId: (payload as ScanResult).scanId, isExample });
      } catch {
        setResult(null);
        setError("the scan could not be completed");
      } finally {
        setRunning(false);
      }
    },
    [exampleUrls, running],
  );

  useEffect(() => {
    if (!result || displayed.current === result.scanId) return;
    displayed.current = result.scanId;
    const isExample = exampleUrls.some((e) => e.url === result.submitted);
    void emit("scan_result_displayed", { scanId: result.scanId, isExample });
  }, [result, exampleUrls]);

  const noCampaignParams =
    result !== null &&
    result.outcome !== "refused" &&
    result.verdicts.filter((v) => v.campaign).length === 0;

  return (
    <div className="mt-12">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(value);
        }}
      >
        <label className="sr-only" htmlFor="chain-url">
          Campaign link to follow
        </label>
        <input
          id="chain-url"
          name="url"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://your.link/offer?utm_source=newsletter"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-4 py-3.5 font-mono text-[13px] text-ink outline-none placeholder:text-muted focus:border-ink/40 focus:bg-paper"
        />
        <button
          type="submit"
          disabled={running}
          className="shrink-0 rounded-lg bg-ink px-7 py-3.5 text-[14px] font-medium tracking-[0.02em] text-paper transition-opacity disabled:opacity-45"
        >
          {running ? "Following" : "Follow the chain"}
        </button>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
        <span>Control chains:</span>
        {exampleUrls.map((example) => (
          <button
            key={example.id}
            type="button"
            className="underline decoration-hairline underline-offset-4 transition-colors hover:text-ink hover:decoration-ink/40"
            onClick={() => {
              setValue(example.url);
              void run(example.url);
            }}
          >
            {example.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-10 rounded-xl border border-hairline bg-surface p-6 text-[15px] text-ink">{error}</p>
      )}

      {result && !error && <ResultCard result={result} onWitnessRun={noCampaignParams ? () => run(result.submitted, true) : undefined} />}
    </div>
  );
}

function ResultCard({ result, onWitnessRun }: { result: ScanResult; onWitnessRun?: () => void }) {
  const campaign = result.verdicts.filter((v) => v.campaign);
  const transitions = result.transitions;

  return (
    <section className="mt-10 rounded-xl border border-hairline bg-surface p-6 md:p-8" aria-live="polite">
      <div className="space-y-1.5">
        {result.summary.map((line, index) => (
          <p
            key={line}
            className={
              index === 0
                ? "text-[17px] font-medium leading-relaxed text-ink"
                : "text-[15px] leading-relaxed text-ink/80"
            }
          >
            {line}
          </p>
        ))}
      </div>

      {result.witnessValues && (
        <p className="mt-5 text-[13px] text-altered">
          Witness values were added to this link on purpose. The run measures the chain, not your campaign.
        </p>
      )}

      {onWitnessRun && (
        <button
          type="button"
          onClick={onWitnessRun}
          className="mt-5 text-[13px] text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
        >
          Run it again with witness values
        </button>
      )}

      {transitions.length > 0 && (
        <div className="mt-8 border-t border-hairline pt-7">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Hop by hop</h3>
          <ul className="mt-4 space-y-3.5">
            {transitions.map((transition, index) => {
              const hop = result.hops[index];
              return (
                <li key={transition.at} className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
                  <div className="flex shrink-0 items-baseline gap-2.5 sm:w-44">
                    <span className="text-[14px] text-ink">Redirect {transition.at}</span>
                    <span className="font-mono text-[12px] text-muted">{hop?.status ?? "no answer"}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    {transition.changes.length === 0 ? (
                      <p className="text-[14px] text-muted">query string forwarded unchanged</p>
                    ) : (
                      <ul className="space-y-1">
                        {transition.changes.map((change) => (
                          <li key={`${change.type}-${change.key}`} className="text-[14px] text-ink">
                            <span className="font-mono text-[13px]">{change.key}</span>{" "}
                            <span className={change.type === "removed" ? "text-missing" : "text-altered"}>
                              {changeLine(change)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 truncate font-mono text-[12px] text-muted">
                      {shortPath(result.steps[index + 1]?.url ?? "")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {campaign.length > 0 && (
        <div className="mt-8 border-t border-hairline pt-7">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            At the final destination
          </h3>
          <ul className="mt-4 space-y-2">
            {campaign.map((verdict) => (
              <li key={verdict.key} className="flex flex-wrap items-baseline gap-x-3 text-[14px]">
                <span className="font-mono text-[13px] text-ink">{verdict.key}</span>
                <span className={statusColour(verdict.status)}>{verdict.status}</span>
                <span className="font-mono text-[12px] text-muted">
                  {verdict.final && verdict.final.length > 0 ? verdict.final.join(", ") : "absent"}
                </span>
                {verdict.absentInTransit && (
                  <span className="text-[12px] text-altered">absent from an intermediate hop</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-hairline pt-7">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          What this run does not tell you
        </h3>
        <ul className="mt-4 space-y-2">
          {result.limits.map((limit) => (
            <li key={limit} className="text-[13px] leading-relaxed text-muted">
              {limit}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
