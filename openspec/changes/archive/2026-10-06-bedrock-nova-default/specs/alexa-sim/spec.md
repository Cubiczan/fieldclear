# Alexa+ simulator

## ADDED Requirements

### Requirement: Production planner is Amazon Nova Lite on Bedrock

The production planner SHALL call Amazon Bedrock Converse with Amazon Nova Lite. The default model id SHALL be the inference profile `us.amazon.nova-lite-v1:0`. The foundation model id `amazon.nova-lite-v1:0` MAY be set with `BEDROCK_MODEL_ID`. The region default SHALL be `us-east-1`. The planner MUST NOT send an Anthropic or Claude model id. The model is Nova Lite because the planner returns one small JSON tool choice.

WHEN `USE_BEDROCK` is `false`, the local heuristic planner SHALL run the turn with no network call. WHEN `USE_BEDROCK` is unset and `NODE_ENV` is `production`, the planner SHALL use Bedrock. WHEN `USE_BEDROCK` is unset and `NODE_ENV` is not `production`, the local heuristic planner SHALL run. A failed Bedrock call SHALL fall back to the local planner. On Vercel, credentials SHALL come from OIDC role assumption (`AWS_ROLE_ARN`) rather than a long-lived access key stored in the repo. WHEN Vercel has no `AWS_ROLE_ARN` and no access key, the turn SHALL stay on the local planner and SHALL NOT call Bedrock. Secrets MUST NOT be committed.

#### Scenario: Default model is Nova Lite

- GIVEN `BEDROCK_MODEL_ID` is unset
- AND `NODE_ENV` is production
- AND the process is not running on Vercel
- WHEN the planner resolves its model
- THEN the model id is `us.amazon.nova-lite-v1:0`
- AND the region is `us-east-1`

#### Scenario: Anthropic model id is refused

- GIVEN `BEDROCK_MODEL_ID` contains `anthropic` or `claude`
- WHEN the planner resolves its model
- THEN the id is refused
- AND the turn runs on the local planner

#### Scenario: Offline opt-out

- GIVEN `USE_BEDROCK` is `false`
- WHEN a turn runs
- THEN the local heuristic planner runs
- AND no Bedrock call is made

#### Scenario: Vercel without a role stays local

- GIVEN `NODE_ENV` is production
- AND `VERCEL` is `1`
- AND `AWS_ROLE_ARN` is unset
- WHEN the dispatcher asks to clear a $240 parts order for truck 3
- THEN the local planner approves the ticket
- AND no Bedrock call is made

## REMOVED Requirements

### Requirement: Bedrock is optional

The previous requirement treated Bedrock as an opt-in flag with no default model. Production now uses Amazon Nova Lite unless `USE_BEDROCK=false`.
