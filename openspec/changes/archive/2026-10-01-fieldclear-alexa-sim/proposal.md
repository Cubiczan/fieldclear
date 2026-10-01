# FieldClear Alexa+ simulator

## What

A Next.js console that behaves like Alexa+ for a small mechanical shop. An in-process, MCP-shaped tool loop checks spend policy, appends a hash-linked audit entry, looks up jobs, and drafts SMS without sending it.

## Why

The Alexa+ hackathon track allows a simulated experience when the team is new to MCP. Judges need to see tool calls, not only a chat transcript.

## Scope

- Seeded Northline Mechanical data, offline by default
- Optional Amazon Bedrock Converse planner behind USE_BEDROCK
- No real Alexa skill, no carrier send, no committed secrets
