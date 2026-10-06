# Tasks

- [x] Production default calls Amazon Nova Lite; `USE_BEDROCK=false` stays offline
- [x] Refuse Anthropic and Claude model ids
- [x] Vercel uses OIDC role assumption when `AWS_ROLE_ARN` is set
- [x] README and `.env.example` list region, model id, and the role ARN
- [x] Tests for the default, the refusal, and the Vercel-without-role path
