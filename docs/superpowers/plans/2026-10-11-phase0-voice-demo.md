# Phase 0 Voice Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /dial` with a lead triggers an outbound AI call within 60s. The agent, a Dubai broker persona configured from Supabase, qualifies the caller and books a viewing, and the results land in Supabase.

**Architecture:** One long-running Node/Fastify voice worker. `/dial` validates the lead, stores it, and asks Twilio to place the call. Twilio fetches TwiML from `/twiml/:leadId`, which streams audio to WS `/media-stream/:leadId`. That socket is bridged to the OpenAI Realtime API through the Agents SDK `TwilioRealtimeTransportLayer`. The agent's persona and prompt variables come from the client's `agents` row in Supabase. Tools write to Supabase.

**Tech Stack:** Node 20+, TypeScript, Fastify (`fastify`, `@fastify/formbody`, `@fastify/websocket`), `@openai/agents` + `@openai/agents-extensions`, `zod`, `twilio`, `@supabase/supabase-js`, `libphonenumber-js`, `vitest`, `tsx`, ngrok (local tunnel).

**Spec:** `C:\Users\Anas Altaf\.claude\plans\i-want-to-plan-resilient-metcalfe.md` (Phase 0 section; architecture and "Making it sound human")

## Global Constraints
- TypeScript only. ESM (`"type": "module"`).
- Realtime model: `gpt-realtime-2.1`, with `gpt-realtime-mini` selectable through env `REALTIME_MODEL`. Turn detection: `semantic_vad`.
- Timezone for every calling-hours decision: `Asia/Dubai`. Default calling hours: `09:00`–`18:00` (start inclusive, end exclusive), overridable per agent row.
- English only.
- The agent must never invent prices or availability. Anything it doesn't know → "I'll have {agent_name} confirm that for you."
- The agent must say it is the brokerage's AI assistant when asked.
- Secrets only from `.env` (`OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_URL`, `DIAL_API_KEY`). `.env` is gitignored; `.env.example` is committed.
- No Zapier/Make, no UltraMsg/Whapi.
- Twilio trial accounts can only call verified numbers. Demo calls go to the developer's own verified phone.

## Review Focus
1. **UAE local-format phone numbers** (`050 123 4567`, `0501234567`, `+971 50…`) must normalize to E.164 `+971501234567`. Garbage → 400, and no call is placed. Owned by Task 1 (`normalizePhone`) and Task 3 (`/dial` 400 test).
2. **`/dial` outside calling hours** must not place a call. It returns 409 with `{ reason: "outside_calling_hours" }`. Owned by Task 1 (`isWithinCallingHours` boundaries) and Task 3.
3. **Missing lead fields** (e.g. no property) must never be spoken as a raw `{property}` placeholder. Fallbacks get filled in. Owned by Task 1 (`fillPrompt`).
4. **Unauthenticated `/dial` or forged Twilio webhooks** must be rejected (401/403). Owned by Task 3.
5. **The caller hanging up mid-call or the WS dropping** must close the OpenAI session and mark the call `completed`/`failed`, not crash the worker or leave a session open. Owned by Task 4.

---

## File Structure
```
uae-voice-agent/
  .gitignore  .env.example  package.json  tsconfig.json
  prompts/broker-base.md          # persona prompt template with {vars}
  supabase/migrations/0001_init.sql
  supabase/seed.sql               # one demo brokerage + agent
  src/core.ts                     # pure logic: normalizePhone, isWithinCallingHours, fillPrompt
  src/core.test.ts                # the one test file
  src/db.ts                       # Supabase client + typed queries
  src/agent.ts                    # buildAgent(config, lead) -> RealtimeAgent
  src/tools.ts                    # makeTools(ctx) -> tools writing to Supabase
  src/server.ts                   # Fastify routes + Twilio/OpenAI bridge
```
Phase 1 later splits these into `apps/voice-worker` + `apps/dashboard`. For now it's a single package, so don't build a monorepo before there's a second app.

---

### Task 1: Project scaffold + pure core logic

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/core.ts`
- Test: `src/core.test.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(raw: string, defaultCountry?: 'AE'): string | null`. Returns E.164 or null for invalid input.
  - `isWithinCallingHours(now: Date, hours?: { start: string; end: string }, timeZone?: string): boolean`. Defaults are `{start:'09:00', end:'18:00'}` and `'Asia/Dubai'`.
  - `fillPrompt(template: string, vars: Record<string, string | null | undefined>, fallbacks: Record<string, string>): string`. Throws `Error('Unfilled prompt variables: a, b')` if any `{x}` remains.

- [ ] **Step 1: Scaffold.** `git init`. Create `package.json` (`"type":"module"`, scripts `dev: tsx watch src/server.ts`, `start: tsx src/server.ts`, `test: vitest run`). Install the Tech Stack deps. Use a strict `tsconfig` (`module`/`moduleResolution: NodeNext`, `target ES2022`). `.gitignore` covers `node_modules`, `.env`. `.env.example` lists every key from Global Constraints with empty values.

- [ ] **Step 2: Write the failing tests** in `src/core.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizePhone, isWithinCallingHours, fillPrompt } from './core.js';

describe('normalizePhone', () => {
  it.each(['050 123 4567', '0501234567', '+971 50 123 4567', '00971501234567'])('UAE %s', (raw) =>
    expect(normalizePhone(raw)).toBe('+971501234567'));
  it('keeps international numbers', () => expect(normalizePhone('+44 7911 123456')).toBe('+447911123456'));
  it.each(['', 'abc', '123', '+971 12'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeNull());
});

describe('isWithinCallingHours (Asia/Dubai = UTC+4, no DST)', () => {
  it('08:59 Dubai is outside', () => expect(isWithinCallingHours(new Date('2026-10-11T04:59:00Z'))).toBe(false));
  it('09:00 Dubai is inside (start inclusive)', () => expect(isWithinCallingHours(new Date('2026-10-11T05:00:00Z'))).toBe(true));
  it('17:59 Dubai is inside', () => expect(isWithinCallingHours(new Date('2026-10-11T13:59:00Z'))).toBe(true));
  it('18:00 Dubai is outside (end exclusive)', () => expect(isWithinCallingHours(new Date('2026-10-11T14:00:00Z'))).toBe(false));
  it('custom hours', () => expect(isWithinCallingHours(new Date('2026-10-11T16:30:00Z'), { start: '10:00', end: '21:00' })).toBe(true));
});

describe('fillPrompt', () => {
  it('fills vars and uses fallbacks for missing values', () =>
    expect(fillPrompt('Hi {name}, about {property}.', { name: 'Ali', property: '' }, { property: 'the property you enquired about' }))
      .toBe('Hi Ali, about the property you enquired about.'));
  it('throws on vars with neither value nor fallback', () =>
    expect(() => fillPrompt('{a} {b}', {}, {})).toThrow('Unfilled prompt variables: a, b'));
});
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL (module `./core.js` has no exports).

- [ ] **Step 4: Implement the three functions in `src/core.ts`.** `normalizePhone` uses `parsePhoneNumberFromString(raw, 'AE')` from `libphonenumber-js` and returns `.number` only if `.isValid()`. `isWithinCallingHours` reads `HH:mm` in the timezone via `Intl.DateTimeFormat('en-GB', { timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' })` and compares the strings `start <= t < end`. `fillPrompt` treats empty, null and undefined values as missing.

- [ ] **Step 5: Run** `npm test`. Expected: all PASS.

- [ ] **Step 6: Commit** `feat: scaffold project and core lead/call logic`.

---

### Task 2: Supabase schema, seed, and data access

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/seed.sql`, `src/db.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/db.ts`):
  - types `AgentConfig { id; client_id; persona_name; brokerage_name; agent_name; voice; prompt_vars: Record<string,string>; calling_start: string; calling_end: string; transfer_number: string | null }`, `Lead { id; client_id; name: string | null; phone: string; property: string | null; source: string }`
  - `getAgentByClientSlug(slug: string): Promise<AgentConfig | null>`
  - `insertLead(input: Omit<Lead,'id'>): Promise<Lead>`
  - `getLeadWithAgent(leadId: string): Promise<{ lead: Lead; agent: AgentConfig } | null>`
  - `upsertCall(call: { lead_id: string; twilio_sid: string; status: 'queued'|'in_progress'|'completed'|'failed'|'no_answer'; ended_at?: string }): Promise<void>`
  - `saveQualification(leadId: string, q: Qualification): Promise<void>` where `Qualification { intent: 'buy'|'rent'; budget_aed: number | null; areas: string[]; bedrooms: number | null; timeline: string | null; notes: string | null }`
  - `saveViewing(leadId: string, v: { preferred_time: string; property: string | null }): Promise<void>`

- [ ] **Step 1: Write `0001_init.sql`.** Tables (all `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`):
  - `clients(slug text unique not null, name text not null)`
  - `agents(client_id uuid references clients not null, persona_name text not null, brokerage_name text not null, agent_name text not null, voice text not null default 'verse', prompt_vars jsonb not null default '{}', calling_start text not null default '09:00', calling_end text not null default '18:00', transfer_number text)`
  - `leads(client_id uuid references clients not null, name text, phone text not null, property text, source text not null default 'api', qualification jsonb, viewing jsonb)`
  - `calls(lead_id uuid references leads not null, twilio_sid text unique not null, status text not null, transcript jsonb, ended_at timestamptz)`
  - Enable RLS on all tables with no policies: only the service-role key gets in, and client logins come in Phase 2.
- [ ] **Step 2: Write `seed.sql`.** Client slug `demo`, name `Marina Bay Realty` (fictional). Agent persona `Sara`, agent_name `Omar`, `prompt_vars` = `{"areas":"Dubai Marina, JBR, Business Bay","specialty":"apartments for sale and rent"}`.
- [ ] **Step 3: Apply.** Create a free Supabase project and run both files in its SQL editor, or use `npx supabase db push` if the CLI is linked. Verify: `select * from agents` in the SQL editor returns 1 row.
- [ ] **Step 4: Implement `src/db.ts`** with `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`. Functions throw on Supabase `error`. `getLeadWithAgent` makes 2 queries (lead, then the agent by `client_id`).
- [ ] **Step 5: Smoke check.** `npx tsx -e "import('./src/db.ts').then(async d => console.log(await d.getAgentByClientSlug('demo')))"`. Expected: prints the Sara config.
- [ ] **Step 6: Commit** `feat: supabase schema, demo seed, data access`.

---

### Task 3: Outbound call end-to-end (`/dial` → phone rings → agent talks)

**Files:**
- Create: `prompts/broker-base.md`, `src/agent.ts`, `src/server.ts`

**Interfaces:**
- Consumes: Task 1 `normalizePhone`, `isWithinCallingHours`, `fillPrompt`; Task 2 `getAgentByClientSlug`, `insertLead`, `getLeadWithAgent`, `upsertCall`.
- Produces:
  - `buildAgent(agent: AgentConfig, lead: Lead, tools?: ReturnType<typeof tool>[]): RealtimeAgent` (in `src/agent.ts`)
  - HTTP: `POST /dial` with header `x-api-key: DIAL_API_KEY`, body `{ clientSlug: string, name?: string, phone: string, property?: string }` → `202 { leadId, callSid }` | `400 { reason: 'invalid_phone' | 'invalid_body' }` | `401` | `404 { reason: 'unknown_client' }` | `409 { reason: 'outside_calling_hours' }`
  - `ALL /twiml/:leadId` → TwiML `<Connect><Stream url="wss://{PUBLIC_URL host}/media-stream/{leadId}"/></Connect>`
  - `WS /media-stream/:leadId`

- [ ] **Step 1: Write `prompts/broker-base.md`.** Vars: `{persona_name} {brokerage_name} {agent_name} {lead_name} {property} {areas} {specialty}`. Contents:
  - The opening line from the spec: "Hi, is this {lead_name}? It's {persona_name} from {brokerage_name}. You enquired about {property} a few minutes ago — is now a good time?"
  - Qualification order: buy or rent → budget in AED → areas → bedrooms → timeline.
  - Style: one question at a time, short spoken sentences, acknowledgements, read numbers back.
  - The Global Constraints rules (no invented prices or availability, AI disclosure).
  - If the lead says it's a bad time → ask when to call back, then end politely.
  Fallbacks used in `buildAgent`: `lead_name` → `there`, `property` → `a property with us`.
- [ ] **Step 2: Implement `buildAgent`.** It reads the template once at module load, calls `fillPrompt` with `{...agent.prompt_vars, persona_name, brokerage_name, agent_name, lead_name: lead.name, property: lead.property}`, and returns `new RealtimeAgent({ name: agent.persona_name, instructions, tools })`.
- [ ] **Step 3: Implement `src/server.ts`**, based on the official Agents SDK Twilio Fastify example:
  - `/dial`: check the API key → zod-parse the body → `normalizePhone` → `getAgentByClientSlug` → `isWithinCallingHours(new Date(), {start: agent.calling_start, end: agent.calling_end})` → `insertLead` → `twilio.calls.create({ to, from: TWILIO_FROM_NUMBER, url: `${PUBLIC_URL}/twiml/${lead.id}`, statusCallback: `${PUBLIC_URL}/call-status/${lead.id}`, statusCallbackEvent: ['initiated','answered','completed'] })` → `upsertCall({status:'queued'})` → 202.
  - `/twiml/:leadId` and `/call-status/:leadId`: reject with 403 unless `twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, PUBLIC_URL + request.url, request.body)` passes.
  - WS: `getLeadWithAgent(leadId)`. If it's null, close the socket. Otherwise `new RealtimeSession(buildAgent(...), { transport: new TwilioRealtimeTransportLayer({ twilioWebSocket: connection }), model: process.env.REALTIME_MODEL ?? 'gpt-realtime-2.1', config: { audio: { input: { turnDetection: { type: 'semantic_vad' } }, output: { voice: agent.voice } } } })`, then `await session.connect({ apiKey: OPENAI_API_KEY })`. Have the agent speak first by sending the opening right after connect (per SDK docs, e.g. `session.sendMessage` / triggering a response).
- [ ] **Step 4: Verify the error paths with curl** while the server runs (`npm run dev` + `ngrok http 5050`, with `PUBLIC_URL` set to the ngrok URL):
  - no `x-api-key` → `401`
  - `phone: "123"` → `400 {"reason":"invalid_phone"}`
  - `clientSlug: "nope"` → `404`
  - temporarily set the seed's `calling_end` to `'00:00'` → `409 {"reason":"outside_calling_hours"}`, and the Twilio console shows no call. Then restore it.
  - `curl -X POST $PUBLIC_URL/twiml/x` (unsigned) → `403`
- [ ] **Step 5: Verify the happy path.** `curl -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' -d '{"clientSlug":"demo","name":"Anas","phone":"<your verified number>","property":"a 2-bed in Dubai Marina"}'` → `202`. Your phone rings within 60s. Sara greets you by name, mentions the property, and asks one qualification question at a time. Interrupting her mid-sentence makes her stop and listen.
- [ ] **Step 6: Commit** `feat: outbound dial with realtime broker agent over twilio`.

---

### Task 4: Tools that persist outcomes + call lifecycle

**Files:**
- Create: `src/tools.ts`
- Modify: `src/server.ts` (pass tools, handle hangup and status)

**Interfaces:**
- Consumes: Task 2 `saveQualification`, `saveViewing`, `upsertCall`, `Qualification`; Task 3 `buildAgent(agent, lead, tools)`.
- Produces: `makeTools(ctx: { leadId: string }): ReturnType<typeof tool>[]`, which returns the tools named `save_qualification` (zod schema mirroring `Qualification`) and `book_viewing` (`{ preferred_time: string, property?: string }`). Each `execute` writes to Supabase and returns a short confirmation string for the model to speak from.

- [ ] **Step 1: Implement `makeTools`.** Tool descriptions tell the model *when* to call them: `save_qualification` once intent, budget and area are known, updating as more comes in; `book_viewing` after the caller agrees a time. Then add to the prompt: "Before booking, read the time back and get a yes."
- [ ] **Step 2: Wire into the WS handler:** `buildAgent(agent, lead, makeTools({ leadId }))`.
- [ ] **Step 3: Call lifecycle.**
  - `/call-status/:leadId` maps Twilio `CallStatus` to our statuses: `in-progress`→`in_progress`, `completed`→`completed`, `no-answer`/`busy`→`no_answer`, `failed`/`canceled`→`failed`. It calls `upsertCall` with `ended_at` on terminal statuses.
  - In the WS handler, on socket `close` call `session.close()`. On `close` or `error`, write `session.history` (text transcript items) to `calls.transcript` with a single update keyed by `twilio_sid`. Wrap all of it in try/catch and log, so a failure here never crashes the process.
- [ ] **Step 4: Verify.** Call yourself, give the agent a budget, area and bedrooms, agree on "Saturday at 4pm", then hang up mid-sentence. Expected in Supabase:
  - `leads.qualification` is filled (`intent`, `budget_aed`, `areas`)
  - `leads.viewing.preferred_time` mentions Saturday 4pm
  - the `calls` row has `status = completed`, `ended_at` set and a non-empty `transcript`
  - the worker is still running and a second `/dial` works.
- [ ] **Step 5: Verify the no-answer path.** Dial yourself and decline the call. Expected: the `calls.status` row ends as `no_answer` or `completed` with no transcript, with no errors in the log.
- [ ] **Step 6: Commit** `feat: persist qualification and viewings, handle call lifecycle`.

---

### Task 5: Demo quality pass + pitch recordings

**Files:**
- Modify: `prompts/broker-base.md` (tuning only)
- Create: `docs/demo-checklist.md`

- [ ] **Step 1: Write `docs/demo-checklist.md`.** Ten role-play scenarios, each with a pass/fail line:
  1. happy path (buyer, budget, viewing booked)
  2. renter instead of buyer
  3. interrupts constantly
  4. asks the exact price of a unit
  5. "are you a robot?"
  6. "call me later"
  7. off-topic question
  8. gives a budget in "1.5 million"
  9. hangs up abruptly
  10. long silence

  Expected behaviors:
  - Scenario 4 → no invented number; it defers to the human agent.
  - Scenario 5 → it discloses it's an AI.
  - Scenario 8 → `budget_aed = 1500000` in the DB.
  - Scenario 10 → it gently re-prompts once, then wraps up.
- [ ] **Step 2: Run all 10.** Get at least 2 other people to do some of them. For each fail, change only the prompt and re-run that scenario.
- [ ] **Step 3: Record unit cost.** From the OpenAI usage page and Twilio call logs, note the cost of 3 calls in `docs/demo-checklist.md`: cost per minute and per average call.
- [ ] **Step 4: Record 2–3 demo calls** (phone on speaker + screen showing the Supabase rows filling in) for LinkedIn and email outreach.
- [ ] **Step 5: Commit** `docs: demo checklist, cost notes; tune broker prompt`.

---

## Done when
All 10 checklist scenarios pass, `npm test` is green, cost per call is recorded, and the demo recordings exist. The next step is Phase 1 (Vercel intake + inbound-email parsers, retry ladder, summary email, dashboard), which gets its own plan.
