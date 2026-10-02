# Jev policy.check decision aid

## What

Add a TypeSafe Jev (System One) Choice + Noul score behind FieldClear `policy.check`. The shop hard rules stay in charge. With no `JEV_API_KEY`, a deterministic local fallback returns the same shape and makes no network call.

## Why

FieldClear is already a go / hold / deny gate. Jev is a calibrated decision API for structured state, which matches that gate better than a chat model. The Alexa+ loop, the ledger, and the SMS draft stay as they are.

## Scope

- Client at `src/lib/jev/client.ts` (`POST https://thejevai.com/v1/systemone`)
- `JEV_API_KEY`, `JEV_MODEL`, `JEV_DUAL_RUN`, `JEV_PRIMARY`
- Approval card, tool summary, and audit row show choice, confidence, and a decision-aid line
- Tests for the client, the fallback, and the gate
