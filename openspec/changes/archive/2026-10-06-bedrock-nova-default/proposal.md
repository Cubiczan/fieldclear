# Amazon Nova Lite as the production planner

## What

Production turns use Amazon Nova Lite on Bedrock Converse. The model id is the inference profile `us.amazon.nova-lite-v1:0` in `us-east-1`. Anthropic and Claude model ids are refused. On Vercel, the client assumes an IAM role with OIDC.

## Why

Cubiczan Bedrock API key users have `DenyMarketplaceAndClaude`. Marketplace Claude calls fail, and promo credits cover Bedrock Nova. The Nova Lite planner already existed behind `USE_BEDROCK=true` and was off in production, so the live app never called it.

## Scope

- Production default: Bedrock Nova Lite unless `USE_BEDROCK=false`
- Local `npm run dev` stays on the heuristic planner unless `USE_BEDROCK=true`
- Vercel auth is `AWS_ROLE_ARN` plus OIDC, not a committed access key
- README and `.env.example` list the env vars the host must set
