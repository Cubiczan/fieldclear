# policy.check

## ADDED Requirements

### Requirement: Shop hard rules stay authoritative

policy.check SHALL approve, hold, or deny a spend ticket from the seeded Northline rules: known truck, open job, category ticket limit, and daily truck cap. A hard deny SHALL stay a deny. A trade mismatch SHALL stay a hold. Jev SHALL NOT turn either of those into an approval.

#### Scenario: Over-cap denial

- GIVEN the seeded policy and no JEV_PRIMARY
- WHEN the dispatcher asks to clear a $2,400 parts ticket for truck 3
- THEN policy.check denies the ticket
- AND the denial is the shop rule, even if Jev would approve

#### Scenario: Trade mismatch stays a hold

- GIVEN truck 3 is on a plumbing job
- WHEN policy.check runs for an in-limit HVAC parts ticket on that truck
- THEN the decision is needs_review
- AND JEV_PRIMARY does not change it to approve

### Requirement: Jev scores the structured job as a decision aid

WHEN policy.check runs, the gate SHALL evaluate one Jev Choice (`approve`, `hold`, `deny`) and Noul questions for hard caps, trade mismatch, notes that need review, and SLA pressure. The state SHALL be structured text (trade, customer notes, caps, window, memo) and SHALL NOT include a customer phone number. The result SHALL carry the choice, confidence, and a decision-aid disclaimer. The spoken Alexa+ flow SHALL still come from the tool decision.

#### Scenario: Local fallback with no key

- GIVEN JEV_API_KEY is unset
- WHEN policy.check clears a $240 parts ticket for truck 3
- THEN no request is sent to the Jev API
- AND the decision is approve
- AND the result includes a fallback signal with choice approve and the decision-aid disclaimer

#### Scenario: Primary can tighten a clear

- GIVEN JEV_API_KEY is set and JEV_PRIMARY is true
- AND Jev returns hold with confidence at or above 0.7
- WHEN the shop rules would approve the ticket
- THEN policy.check returns needs_review
- AND the reason says it is a decision aid

#### Scenario: Dual-run keeps the shop decision

- GIVEN JEV_DUAL_RUN is true and JEV_PRIMARY is not true
- AND Jev returns hold
- WHEN the shop rules would approve
- THEN the decision stays approve
- AND the result records both the shop decision and the Jev decision

### Requirement: API failure uses the same fallback

WHEN JEV_API_KEY is set and the System One call fails, times out, or returns an unusable body, policy.check SHALL use the deterministic fallback and still return a decision. A 429 or 529 SHALL be retried once before that fallback.

#### Scenario: Unauthorized key

- GIVEN the Jev call returns HTTP 401
- WHEN policy.check runs for an in-limit ticket on an open job
- THEN the source is fallback
- AND the shop decision is unchanged when JEV_PRIMARY is not set
