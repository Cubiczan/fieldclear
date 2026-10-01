# Alexa+ simulator

## Requirements

### Requirement: Dispatcher can talk to a simulated Alexa+

The home page SHALL present a voice-style console that accepts typed or spoken utterances and answers from the agent loop. The console MUST show the tool-call trail, an approval card when spend is checked, and the append-only audit log.

#### Scenario: Parts clearance

- GIVEN the seeded Northline board
- WHEN the dispatcher asks to clear a $240 parts order for truck 3
- THEN policy.check approves the ticket
- AND ledger.append writes a hash-linked spend.approve entry
- AND the console shows an approval card with the reason

#### Scenario: Over-cap denial

- GIVEN the seeded policy
- WHEN the dispatcher asks to clear a $2,400 compressor for truck 3
- THEN policy.check denies the ticket
- AND the audit log records the denial
- AND the spoken reply does not claim the spend was cleared

#### Scenario: Pending jobs

- GIVEN Acme Plumbing has a water heater install
- WHEN the dispatcher asks what is pending for Acme Plumbing
- THEN jobs.lookup returns that job
- AND blockers already satisfied by the audit log are omitted

#### Scenario: SMS stays a draft

- GIVEN tomorrow's install is on the board
- WHEN the dispatcher asks for a customer SMS confirming it
- THEN sms.draft returns a message with sent false
- AND the console labels the message as not sent

### Requirement: Tool loop is MCP-shaped and in-process

The agent host SHALL discover tools through listTools and invoke them through callTool. Each tool SHALL expose a name, description, and JSON Schema input. The loop MUST NOT skip policy.check before a spend answer.

#### Scenario: Registry lists the four tools

- WHEN listTools is called
- THEN the names are policy.check, ledger.append, jobs.lookup, and sms.draft

### Requirement: Bedrock is optional

WHEN USE_BEDROCK is not true, the local heuristic planner SHALL run the turn with no network call. WHEN USE_BEDROCK is true, the planner MAY call Amazon Bedrock Converse, and a failed call SHALL fall back to the local planner. Secrets MUST NOT be committed.
