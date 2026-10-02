# Design

`policy.check` still evaluates the Northline rules first. Unknown truck, idle truck, ticket limit, and daily cap are hard denies. A trade mismatch is a hold. Those outcomes cannot be loosened.

The same structured state (amount, caps, truck, job trade, notes, window, memo, hard-rule ids) is sent to Jev as one Choice (`approve` | `hold` | `deny`) and four Noul questions (within caps, trade mismatch, notes need review, SLA pressure). Phone numbers and street addresses stay off the request.

No `JEV_API_KEY`, or a failed call, uses `fallbackPolicySignal`. The fallback is a fixed function of that state: hard rules deny, trade mismatch or review language or urgent memo holds, otherwise approve. Waiting on parts alone does not hold, so the $240 truck 3 demo still clears.

`JEV_PRIMARY=true` may only tighten: clear can become hold or deny, hold can become deny, when Choice confidence is at least 0.70 or a Noul crosses its threshold (0.65 trade/notes, 0.80 SLA). Below 0.70, approve or deny escalates to review. `JEV_DUAL_RUN=true` stores both decisions and leaves the shop rule in place unless primary is also on.

The approval card and the audit payload show the signal. Spoken replies stay composed from the tool decision, so the voice loop does not invent a clearance.

Model default is `jev-1.13.0` (`JEV_MODEL` overrides). One retry on HTTP 429 or 529, then the local fallback. Timeout is 2.5s.
