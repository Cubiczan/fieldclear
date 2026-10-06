# Design

`bedrockPlan()` is the single switch for the planner.

- `USE_BEDROCK=false` forces the local heuristic planner and makes no AWS call.
- `USE_BEDROCK=true` forces Bedrock in every environment.
- Unset follows `NODE_ENV`: production uses Bedrock, development stays local so the offline demo still runs with no keys.

The model id defaults to `us.amazon.nova-lite-v1:0`. `amazon.nova-lite-v1:0` is the foundation-model alternative. An id containing `anthropic` or `claude` throws, and the turn stays on the local planner. The planner only returns one JSON tool choice, so Nova Lite is the model.

On Vercel (`VERCEL=1`), `AWS_ROLE_ARN` selects `@vercel/oidc-aws-credentials-provider`, which exchanges the Vercel OIDC token for short-lived credentials. A long-lived key pair still uses the AWS SDK default chain, and it is not the documented path. With neither on Vercel, the turn stays local instead of waiting on the instance metadata service. Outside Vercel, the default credential chain is unchanged.

A Bedrock error still falls back to the heuristic planner. `maxAttempts` is 1 so that fallback is the next step, not a retry loop. Secrets stay out of the repo.
