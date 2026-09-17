# Comparison manifest

Date of the review: **17 September 2026**. Everything below was read on that day, by
opening the pages in a browser at reading pace. Anyone can redo it in about a minute
with the witness chain given here.

## Why this document exists

This prototype only earns its place if it answers a question that the public tools
already in the field do not answer directly. That has to be checked against those
tools on the same chain, before building, and written down with its date. A tool that
turns out to be another presentation of an existing checker should be abandoned, not
justified afterwards.

## The witness chain

```
https://utm-chain-check.theaipipe.com/c/changed/0?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale&utm_content=header-link
```

It is hosted here, so its behaviour is known in advance: two redirects, and the second
one rewrites `utm_campaign` from `spring-sale` to `summer-sale`. Every other campaign
parameter is forwarded untouched. The chain is the `changed` control chain of this
repository.

## What was reviewed

| Interface | How it was exercised |
|---|---|
| `findredirect.com/301-redirect-checker` | Witness chain submitted, result panel read, `Details` opened, the per step `View Details` panel opened on the redirect that rewrites the value. |
| `redirhub.com/redirect-checker` | Same witness chain submitted, result panel and step table read. It renders the same result panel as the page above. |

Both were read on 17 September 2026. Raw captures were kept outside this repository:
the pages belong to their publisher, and the manifest quotes only the labels needed
to state what was on screen.

## Observations

Status vocabulary, used strictly: **Observed** means it was on screen during this
review. **Not observed in reviewed public interfaces** means it was not on screen in
what was reviewed, which is not a claim about the product as a whole. **Not assessed**
means it was out of scope of this review.

| Observation | Status |
|---|---|
| Final status code, number of redirects, total response time | Observed |
| Step table with the full URL of every hop, its status and its timing | Observed |
| Per step panel with the resolved IP, the scheme, the TLS verification and the raw response headers, the `Location` header included | Observed |
| A note on the kind of redirect, temporary against permanent | Observed |
| A sentence naming which expected campaign parameter disappeared, changed, was duplicated or re-encoded | Not observed in reviewed public interfaces |
| The transition at which that happened, with the value before and the value after | Not observed in reviewed public interfaces |
| A distinction between what happens at each hop and what is left at the final destination | Not observed in reviewed public interfaces |
| A stated policy for comparing values whose encoding differs | Not observed in reviewed public interfaces |
| Bulk mode, the other tool pages of findredirect.com, any feature behind a login, any API | Not assessed |

## What that means, stated carefully

The reviewed interfaces already put the raw material on screen: the full URL of every
hop and the raw response headers. A reader who compares two long URLs character by
character can find the rewritten value. The difference this prototype makes is not
access to new data, it is the decision computed from that data and written as a
sentence: which parameter, which transition, which values.

Two counts that are easy to overstate and are not used as evidence anywhere here: a
sitemap of 216 URLs is not 216 pages, and 49 tool URLs are not 49 distinct tools. A
sitemap is not an inventory of features, so nothing in this repository claims that
something does not exist somewhere in a product.

## Decision

**Continue.** On the witness chain, the reviewed interfaces reported the chain and its
headers, and the sentence naming the changed parameter at its transition was not among
what they rendered. That sentence is the whole point of this prototype, so it was
built.

## How to redo this review

1. Open one of the interfaces above.
2. Paste the witness chain.
3. Run it, open every detail panel available.
4. Look for a statement naming a campaign parameter and the transition where it
   changed, with the values before and after.
5. Run the same chain on <https://utm-chain-check.theaipipe.com> and compare the two
   answers.
