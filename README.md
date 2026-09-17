# UTM Chain Check

**A working campaign link experiment, with tested instrumentation.**
Functional checks completed. Growth impact not evaluated.

Live: <https://utm-chain-check.theaipipe.com>

## The question it answers

Follow a campaign link through every redirect and say, in a sentence, what happened to
the campaign parameters:

```
HTTP chain completed: 2 redirects.
utm_content, utm_medium, utm_source preserved.
utm_campaign changed at redirect 2: spring-sale to summer-sale.
Final destination responded with HTTP 200.
Analytics attribution not checked.
```

Two readings, because one is not enough. What changes at each hop, and what is left at
the final destination: a parameter can disappear and come back, and keeping the name is
not keeping the value. Removed, changed, added, duplicated and re-encoded are reported
separately, and the comparison policy is stated: values are compared after percent
decoding, with a plus sign read as a space, so a different encoding of the same value
is an encoding difference, never a change.

## What it does not tell you

1. A link with no campaign parameter is not a pass. Witness values can be added on
   purpose, and a run that uses them says so.
2. The HTTP chain is not the whole journey. Redirects done in JavaScript, signed in
   flows and cookie based routing are out of scope.
3. Parameters kept in the URL is not attribution validated. An analytics property can
   still drop, rename or transform them.

## Control chains

The chains the checker is tested against are served by this application, so their
behaviour is known in advance and is the oracle of the suite. Public third party links
change without notice and are only ever a complement.

| Chain | What it does | What the checker must report |
|---|---|---|
| `preserved` | three redirects, query forwarded untouched | no parameter removed, changed, added or duplicated |
| `dropped` | redirect 2 forwards without `utm_content` | `utm_content` removed at redirect 2 |
| `changed` | redirect 2 rewrites the campaign value | `utm_campaign` changed at redirect 2, with both values |
| `duplicated` | redirect 1 appends a second `utm_source` | `utm_source` duplicated, two values at the end |
| `restored` | a parameter leaves at redirect 1 and comes back at redirect 2 | present at the end, absent from an intermediate hop |
| `reencoded` | the campaign value is written fully percent encoded | not a change, an encoding difference |
| `stripped` | the query string is dropped entirely | every submitted parameter removed |
| `loop` | the first hop redirects to itself | stopped and reported as a loop |
| `broken` | two redirects then a 404 | chain completed, final status 404 |

Three more exist for the recipe only: `slow`, `oversized` and `private-hop`.

Try one: `/c/changed/0?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link`

## Running it

```bash
npm install
npm run build
npm test                 # unit checks, the security recipe, the control chains
npm run test:journey     # a real browser, from the click to the query
npm run dev              # http://localhost:3000
```

The checks start the built application themselves. The journey check needs a browser:
`npx playwright install chromium`.

## Security

The checker fetches links submitted by strangers, so it is written as a list of
refusals: schemes, ports and credentials, every address classified before any
connection, the connection opened to the address that was validated rather than to the
name, redirects resolved and judged again one at a time, hop, time, header and byte
budgets that actually abort, limits per address and per destination, and no submitted
link ever written to a log as it was submitted.

The recipe that proves it is in `tests/security-recipe.test.ts`, and it does not take
the checker's word for anything: a real listener on the loopback interface counts the
connections it receives and has to stay at zero. Details in
[`docs/security.md`](docs/security.md).

## Measurement

The instrumentation runs end to end: an action in the browser, an event received,
stored and deduplicated, and a query executed over what was recorded. Automated runs
and demonstration runs are kept apart from real usage by the contract itself, and a
check neutralises the emitter and requires the journey check to fail.

Protocol, event contract, recipe and the executed query:
[`docs/experiment-card.md`](docs/experiment-card.md).

## Why this exists

The prototype was built from a published guide that asks the reader to follow a
campaign link through every redirect and confirm what is left at the end. Before
building it, the same witness chain was submitted to the public checkers in the field,
and what they rendered was written down with its date and its statuses in
[`docs/comparison-manifest.md`](docs/comparison-manifest.md). Whether this prototype
changes anything for a reader of that guide has not been tested, and nothing here
claims it does.

## Stack

Next.js and TypeScript, Tailwind, deployed on Vercel. No third party service, no model
call of any kind, no key. The whole checker is Node standard library.

MIT licensed.
