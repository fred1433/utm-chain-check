import ChainChecker from "@/components/ChainChecker";
import GuideLink from "@/components/GuideLink";

const REPOSITORY = "https://github.com/fred1433/utm-chain-check";
const GUIDE = "https://www.redirhub.com/blog/how-to-preserve-utm-parameters-through-redirects";
const MANIFEST = `${REPOSITORY}/blob/main/docs/comparison-manifest.md`;
const EXPERIMENT_CARD = `${REPOSITORY}/blob/main/docs/experiment-card.md`;
const BOOKING = "https://cal.theaipipe.com";

const measure: { label: string; body: React.ReactNode }[] = [
  {
    label: "Hypothesis",
    body: "A reader who is told which parameter changed, and where, is more likely to act on their own links than a reader told only that the chain has three hops.",
  },
  {
    label: "Primary measure",
    body: "Sessions that ran a scan on a link of their own and then clicked through to the guide, over sessions exposed. Computed by a query that runs in the checks, against the event contract, on the recorded test dataset.",
  },
  {
    label: "Guardrails",
    body: "Scans that end in a refusal or a timeout, events rejected by the collector, and outbound requests per minute. Any security defect stops the run.",
  },
  {
    label: "Decision",
    body: "Review at fourteen days as a management choice, not a statistical claim. Insufficient exposure is reported as insufficient exposure, and no conversion target is invented.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto w-full max-w-[860px] px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">UTM Chain Check</p>
        <h1 className="mt-7 text-[40px] font-semibold leading-[1.06] tracking-[-0.028em] text-ink sm:text-[56px] md:text-[64px]">
          Which parameter changed,
          <br className="hidden sm:block" /> and at which redirect.
        </h1>
        <p className="mt-8 max-w-[640px] text-[17px] leading-[1.65] text-muted md:text-[19px]">
          A working campaign link experiment, with tested instrumentation. Follow a link through
          every hop and read what happened to the campaign parameters, value by value.
        </p>
        <p className="mt-5 text-[13px] text-muted">
          Functional checks completed. Growth impact not evaluated.
        </p>

        <ChainChecker />
      </section>

      <section className="border-t border-hairline bg-surface">
        <div className="mx-auto w-full max-w-[860px] px-6 py-24 md:py-32">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Why this experiment
          </h2>
          <div className="mt-8 max-w-[680px] space-y-6 text-[17px] leading-[1.7] text-ink md:text-[18px]">
            <p>
              The RedirHub guide on preserving UTM parameters through redirects asks the reader to
              follow a link through every hop, confirm the final address still carries the expected
              values, and keep a small log of expected against observed. This prototype is that
              interaction, already built.
            </p>
            <p>
              On the public interfaces reviewed on 17 September 2026, a chain check reports status
              codes, the hops and the final destination. Naming which expected parameter disappeared
              or changed, at which transition, with the values before and after, was not observed in
              those interfaces. That single answer is what this prototype returns.
            </p>
            <p>
              Whether it changes anything for a reader of the guide has not been tested, and nothing
              here claims it does.
            </p>
          </div>
          <p className="mt-9 text-[14px] text-muted">
            The pages that were reviewed, the rules used to read them, and each observation with its
            status are listed in the{" "}
            <a
              href={MANIFEST}
              className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
            >
              comparison manifest
            </a>
            . The guide itself is{" "}
            <GuideLink
              href={GUIDE}
              className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
            >
              here
            </GuideLink>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[860px] px-6 py-24 md:py-32">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Ready to measure
        </h2>
        <p className="mt-8 max-w-[680px] text-[17px] leading-[1.7] text-ink md:text-[18px]">
          The instrumentation runs end to end already: an action in the browser, an event received,
          stored and deduplicated, and a query executed over what was recorded. Carrying it would
          take one entry point from the guide, subject to your agreement, since a page that sits
          outside your site builds no audience on its own. Nothing is measured on your side, and no
          traction is shown.
        </p>
        <dl className="mt-12 space-y-7">
          {measure.map((row) => (
            <div key={row.label} className="flex flex-col gap-2 border-t border-hairline pt-6 md:flex-row md:gap-10">
              <dt className="shrink-0 text-[13px] font-medium text-ink md:w-40">{row.label}</dt>
              <dd className="max-w-[560px] text-[15px] leading-[1.7] text-muted">{row.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-[14px] text-muted">
          Event contract, recipe cases, the executed query and its ClickHouse wording are in the{" "}
          <a
            href={EXPERIMENT_CARD}
            className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
          >
            experiment card
          </a>
          . Mapping it onto an analytics store of yours remains to be agreed.
        </p>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 py-12 text-[13px] text-muted md:flex-row md:items-center md:justify-between">
          <p>
            Built by Frederic de Lavenne de Choulot.{" "}
            <a
              href={REPOSITORY}
              className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
            >
              Source, control chains and checks
            </a>
            .
          </p>
          <a
            href={BOOKING}
            className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink/40"
          >
            https://cal.theaipipe.com
          </a>
        </div>
      </footer>
    </main>
  );
}
