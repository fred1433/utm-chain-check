# Security of the public checker

This page accepts a link from anyone and asks a server to fetch it. That is a request
forgery engine unless it is built as a list of refusals, so it is.

## Rules

**The link itself**

* `http` and `https` only, nothing else
* a link carrying credentials is refused
* ports: 80 and 443, plus any port an operator has allowlisted explicitly
* parsing is done by the WHATWG URL parser, so the decimal, octal and mapped
  spellings of an address land on the same verdict as the plain one
* at most 2048 characters

**The destination**

* the name is resolved once, and every address it answers with is classified
* loopback, private, carrier grade NAT, link local including the cloud metadata
  address, multicast, benchmarking, documentation and reserved ranges are refused, in
  IPv4 and in IPv6, including the IPv4 mapped, IPv4 translated and 6to4 forms
* if any address of a name is refused, the whole name is refused
* the connection is opened to the address that was just classified, not to the name,
  so a name that answers differently a moment later cannot move the connection. The
  host name and the TLS identity check keep using the name, so certificates are still
  verified against it

**The chain**

* automatic redirect following is off, every `Location` is resolved and judged again
  from scratch
* ten hops at most, a time budget for the whole chain, a timeout per request, a header
  size cap and a byte cap on the body, all of which actually abort the request
* a chain that returns to a link it already used is stopped and reported as a loop

**The service**

* GET only, no cookie, no header of the visitor is forwarded
* limits per address, per destination and for the page as a whole, a concurrency
  limit, and a breaker that pauses outbound requests after repeated failures
* the answer is JSON, rendered as text, never as third party HTML
* links are submitted by POST, never in a URL. They are never written to a log as they
  were submitted: a per process salt turns the destination host into an opaque label,
  which is enough to spot abuse and tells nobody what anyone scanned
* no analytics event ever carries a submitted link

## The operator allowlist

`UTM_CHAIN_CHECK_ALLOWLIST` lets whoever runs the service name origins, as
`host:port`, that may be reached even when their address is private. It is the only
way a private destination is ever contacted, it is empty by default, and it is empty
on the deployed page. A check asserts that with the default policy a private
destination is refused. The test suite uses it to reach its own server on the loopback
interface, which is exactly what it is for.

## The recipe that blocks delivery

`tests/security-recipe.test.ts`. For the cases that must be refused, the proof is not
the report the checker writes about itself: a real listener is started on the loopback
interface and counts the connections it receives, and every outbound request the
checker opens is recorded next to it. Both have to be empty.

| Case | Required outcome |
|---|---|
| a private destination submitted directly | refused, zero connections recorded |
| a redirect towards a forbidden destination | refused at that hop, zero connections recorded |
| the IPv6 spellings of a local address, mapped forms included | refused, zero connections recorded |
| a name that answers with a public address, then with a local one | connection opened to the validated address only, the name resolved once |
| a redirect loop | stopped and reported as a loop |
| a chain that never ends | stopped at the hop limit |
| a slow destination | aborted within the time budget |
| an oversized destination | reading stopped at the byte cap, response marked truncated |
| the headers and cookies of the visitor | never part of the outbound request |

Without this recipe passing, the demonstration would have to be restricted to hosts
under our control, and the page would have to say so.

## What is not covered

The checker follows HTTP redirects. Redirects performed in JavaScript, signed in
flows, cookie based routing and anything a browser does after the final response are
outside it. Nothing here validates attribution in an analytics property.
