# FieldClear

Simulated Alexa+ for a small multi-trade shop. A dispatcher talks to it the way they would talk to Alexa+: clear a parts charge, ask what is still open, or draft the customer text for tomorrow's install.

Northline Mechanical is seeded in the repo (four trucks, three open jobs, a spend policy, and a short audit history). The demo runs with no API keys.

This is the hackathon's **simulated Alexa+** path, not a certified Alexa skill:

> New to MCP? Build a simulated Alexa+ experience in a web app using your preferred agentic tool.

The simulator is the web console. The agent is an in-process tool loop shaped like MCP. Nothing here submits a skill, sends an SMS, or moves money.

## What a turn looks like

You say: **"Clear a $240 parts order for truck 3."**

1. The host parses the utterance and asks the planner for one action at a time.
2. `policy.check` approves, holds, or denies the ticket against the shop rules.
3. `ledger.append` writes a hash-linked audit entry copied from that decision. It will not approve a ticket the policy tool denied.
4. The console speaks the result, shows an approval card, and leaves the tool trail on screen.

"What's pending for Acme Plumbing?" calls `jobs.lookup`. "Draft a customer SMS confirming tomorrow's install" calls `jobs.lookup`, then `sms.draft`, then logs the draft. `sms.draft` always returns `sent: false`.

## How this maps to MCP

There is no socket server. The shapes match the MCP tool surface so the loop is visible in the code.

| MCP idea | FieldClear |
| --- | --- |
| Host | The console. Entry: `runAgentLoop` in `src/lib/agent/loop.ts` |
| HTTP entry | `POST /api/agent` in `src/app/api/agent/route.ts` |
| Client loop | Plan → `callTool` → observe → repeat, up to six steps |
| `tools/list` | `listTools()` in `src/lib/mcp/registry.ts` |
| `tools/call` | `callTool(name, args)` in the same file |
| Tool result | `{ content: [{ type: "text", text }], structuredContent, isError }` |
| `prompts/list` | `listPrompts()` — the demo utterances |
| `resources/list` | `listResources()` — `fieldclear://policy/northline` |

Tools, in call order when a spend turn needs them:

| Tool | Job |
| --- | --- |
| `policy.check` | Ticket limit, daily truck cap ($800), open job, trade match |
| `ledger.append` | Append-only hash chain (CHP-lite). Spend rows must cite a real policy decision |
| `jobs.lookup` | Seeded trucks, customers, windows, and blockers |
| `sms.draft` | Writes a text. Does not send it |

The host checklist in `runAgentLoop` refuses to finish a spend answer that skipped `policy.check`, and it refuses to finish a draft request that skipped `sms.draft`. A model can choose arguments. It cannot skip the check.

The spoken reply is composed from tool results in `src/lib/agent/compose.ts`, so the planner cannot invent a clearance the tools did not return.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

```bash
npm run check:loop   # the three demo utterances plus a denial, no browser
npm run build
npm start            # production, same port
```

The console keeps the audit chain in the browser session and sends it with each turn, so the demo works on Vercel without a database. **Reset demo** restores the seeded history. `npm run check:loop` still writes a local file under `.data/` (gitignored) or `FIELD_DATA_DIR`.

## Environment

Copy `.env.example` to `.env.local` only if you are turning Bedrock on. The default is the local heuristic planner, labeled **Local planner** in the header. It is a deterministic checklist, not a model.

| Variable | Purpose |
| --- | --- |
| `USE_BEDROCK` | `true` sends each planning step to Amazon Bedrock Converse |
| `AWS_REGION` | Region for the Bedrock client. Default `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Standard credential chain. Never commit these |
| `BEDROCK_MODEL_ID` | Model or inference profile. Default `us.amazon.nova-lite-v1:0` |
| `FIELD_DATA_DIR` | Optional override for the audit log directory |

If Bedrock is enabled and the call fails, the turn falls back to the local planner and the header says so.

### AWS Builder mini challenge

With credentials available:

```bash
USE_BEDROCK=true AWS_REGION=us-east-1 npm run dev
```

Tool choice then goes through [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) in `src/lib/agent/bedrock.ts`. Policy, the ledger, jobs, and the SMS draft still run locally. If your account requires a different inference profile, set `BEDROCK_MODEL_ID`.

[Strands Agents](https://strandsagents.com/) is a natural swap for the planner only. Implement the same `Decision` returned by `decideHeuristic` / `decideWithBedrock` (`{ type: "tool", name, arguments }` or `{ type: "final" }`) and call it from `nextDecision` in `src/lib/agent/loop.ts`. Leave `callTool` as the thing that actually runs. This repo does not depend on Strands, so the offline demo stays free of extra credentials.

## 60-second demo script

Record the browser at [http://127.0.0.1:43123](http://127.0.0.1:43123). Click **Reset demo** first so the log is the seeded three lines. Leave spoken replies on if the room can hear them.

| Time | Do this | Say this |
| --- | --- | --- |
| 0:00 | Show the orb, the four trucks, and the suggestion chips | "This is FieldClear, a simulated Alexa+ for a mechanical shop. No skill console, no keys." |
| 0:08 | Click **Clear a $240 parts order for truck 3** | "Watch the trail. policy.check clears it. ledger.append writes a hash-linked line." |
| 0:22 | Point at the green approval card, then the new audit row | "The card is the decision. The log is the proof. Chain stays intact." |
| 0:32 | Click **What's pending for Acme Plumbing?** | "jobs.lookup reads the board. The parts blocker is gone. The confirmation text is still open." |
| 0:44 | Click **Draft a customer SMS confirming tomorrow's install** | "sms.draft writes Jordan's text and stops. The badge says not sent." |
| 0:55 | Leave the draft card on screen | "Same loop a dispatcher would want on the truck. Nothing left the machine." |

Under three minutes, add one more beat: click **Clear a $2,400 compressor for truck 3**. The policy tool denies it (over the $500 parts ticket and the $800 daily cap) and the denial is logged. That is the shot that shows Alexa+ cannot talk its way past the rule.

## Shop rules (seed)

- Parts auto-clear at or under $500, fuel $150, tools $300, anything else $100.
- A truck can clear at most $800 in a shop day (America/New_York).
- The truck needs an open job. Truck 4 is idle on purpose.
- A trade mismatch (HVAC parts on a plumbing job) is held for the office.
- Acme Plumbing's water heater is tomorrow on truck 3, tech Luis Ortega, contact Jordan Hale.

## Out of scope

Alexa developer console, skill certification, a real SMS send, Fire TV, Bee, Ring, and the Devpost submission itself.

## Layout

```
src/lib/agent/loop.ts          runAgentLoop — host
src/lib/agent/planner.ts       local heuristic planner
src/lib/agent/bedrock.ts       Bedrock Converse planner
src/lib/agent/compose.ts       spoken reply from tool results
src/lib/mcp/registry.ts        listTools / callTool / listPrompts / listResources
src/lib/tools/                 policy, ledger, jobs, sms
src/app/api/agent/route.ts     streaming NDJSON for the console
src/components/console/        Alexa+ console
```
