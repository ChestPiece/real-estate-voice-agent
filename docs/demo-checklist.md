# Phase 0 Demo Checklist

## 1. One-time setup
**Done:** `OPENAI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in `.env`, and `0001_init.sql` and `seed.sql` are applied (Sara exists).

UAE numbers: the code accepts any format (`+971 54 258 7669`, `0542587669`, `00971…`, `971…`) and stores E.164 (`+971542587669`).

### 1a. Supabase: run once in the SQL editor (~1 min)
```sql
-- 0002: guard the calling-hours format
alter table agents
  add constraint calling_start_hhmm check (calling_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_end_hhmm check (calling_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_window_same_day check (calling_start < calling_end);

-- company number = human transfer target for the demo brokerage
update agents set transfer_number = '+971542587669' where persona_name = 'Sara';
select persona_name, transfer_number, calling_start, calling_end from agents;
```

### 1b. Twilio trial (~10 min)
1. Sign up at twilio.com (the free trial includes credit). Pick **Voice** and **TypeScript/Node** when it asks.
2. Console → **Phone Numbers → Verified Caller IDs** → add **+971 54 258 7669**. Twilio calls it and reads a code; enter the code.
   On a trial you can **only call verified numbers**, so also verify every phone you'll role-play with.
3. Console → **Phone Numbers → Buy a number** → take a free **US** number with Voice. Twilio won't let a UAE number place outbound calls.
4. Console → **Voice → Settings → Geo permissions** → tick **United Arab Emirates**. Without it, calls to +971 are blocked.
5. Copy the **Account SID** and **Auth Token** from the Console home.

**Caller ID choice (`TWILIO_FROM_NUMBER`):**
- Start with the **US Twilio number**. It always works.
- Then try `+971542587669` (now verified) and see whether the lead's phone shows it. UAE carriers often block or replace +971 caller IDs that come from abroad unless the number is allowlisted with du/Etisalat.
  If calls don't connect or show "Unknown", go back to the US number. A UAE-allowlisted route (local SIP trunk) is a **must before the first paid client**.

### 1c. ngrok (~5 min)
1. Sign up at ngrok.com (free), then `winget install ngrok.ngrok` and `ngrok config add-authtoken <token>`.
2. `ngrok http 5050` and copy the `https://…ngrok-free.app` URL. The free URL changes on every restart unless you claim your free static domain in the ngrok dashboard. Use that.

### 1d. Fill in the rest of `.env`
```
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_FROM_NUMBER=+1…            # or +971542587669, see caller ID above
PUBLIC_URL=https://xxxx.ngrok-free.app   # no trailing slash
DIAL_API_KEY=<random>             # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
`DIAL_API_KEY` also signs the media-stream URLs, so changing it mid-call drops that call.

### 1e. Run
`npm install && npm test`, then `npm run dev` (keep ngrok running in a second terminal).

## 2. Smoke calls
In Git Bash, load the env first: `set -a; source .env; set +a`
```bash
# should return 401 / 400 / 404
curl -s -X POST $PUBLIC_URL/dial -w "%{http_code}\n"
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' -d '{"clientSlug":"demo","phone":"123"}'
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' -d '{"clientSlug":"nope","phone":"0501234567"}'

# real call (Dubai 09:00–18:00 only, otherwise 409)
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' \
  -d '{"clientSlug":"demo","name":"Anas","phone":"<your verified +971 number>","property":"a 2-bed in Dubai Marina"}'
```
Expected: your phone rings within 60s (the Twilio trial plays a short notice first). Sara opens with your name and the property.
After hanging up, Supabase has `leads.qualification` / `leads.viewing` filled in, and a `calls` row with status, `ended_at` and transcript.

| Response | Meaning / fix |
|---|---|
| `502 dial_failed` + message | Twilio refused: unverified number (trial), UAE geo permission off, or wrong `TWILIO_FROM_NUMBER` |
| `500 agent_misconfigured` | The agent row is missing `prompt_vars` (`areas`, `specialty`) |
| Rings, then silence | Check the `npm run dev` logs for `realtime connect failed` (OpenAI key/model) and check that `PUBLIC_URL` matches the live ngrok URL |
| `409` | Outside 09:00–18:00 Dubai. For a late test, temporarily `update agents set calling_end='23:00'` |

## 3. Role-play scenarios (all must pass before pitching)
| # | Scenario | Pass when | ✅/❌ |
|---|---|---|---|
| 1 | Happy path: buyer, budget, area, books Saturday 4pm | Reads the time back; `viewing.preferred_time` saved | |
| 2 | Renter instead of buyer | `qualification.intent = rent` | |
| 3 | Interrupts constantly | Stops talking immediately and listens | |
| 4 | Asks the exact price of a unit | Invents no number; "I'll have Omar confirm that" | |
| 5 | "Are you a robot?" | Says honestly it's the brokerage's AI assistant | |
| 6 | "Call me later" | Asks when, confirms, ends politely | |
| 7 | Off-topic question | Steers back politely | |
| 8 | Budget given as "1.5 million" | `budget_aed = 1500000` in the DB | |
| 9 | Hangs up abruptly | `calls` row completed with transcript; the worker keeps running and a second `/dial` works | |
| 10 | Long silence | Gently re-prompts once, then wraps up | |

Get at least 2 other people to run some of these. For each ❌, change **only** `prompts/broker-base.md` and re-run that scenario.

## 4. Unit cost (fill in after 3 calls)
| Call | Minutes | OpenAI $ | Twilio $ | Total $ |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| **Avg per minute** | | | | |

To cut cost, try `REALTIME_MODEL=gpt-realtime-mini` and re-run scenarios 1, 3 and 4 to check quality.

## 5. Pitch assets
Record 2–3 calls (phone on speaker + screen showing the Supabase rows filling in) for LinkedIn and email outreach.
