# Phase 0 Demo Checklist

## 1. One-time setup (~30 min)
1. **Supabase** (free): create a project → SQL editor → run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`.
   Check: `select * from agents;` returns Sara.
2. **Twilio** (trial): sign up, verify your own phone number, and get a voice-capable number.
   Copy the Account SID, Auth Token and number.
3. **ngrok**: `ngrok http 5050`, then copy the `https://…ngrok…` URL.
4. `cp .env.example .env` and fill it in:
   - `PUBLIC_URL`: the ngrok URL, no trailing slash
   - `DIAL_API_KEY`: any long random string
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase → Settings → API (keep it secret, server only)
5. `npm install && npm test`, then `npm run dev`.

## 2. Smoke calls
```bash
# should return 401 / 400 / 404
curl -s -X POST $PUBLIC_URL/dial -w "%{http_code}\n"
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' -d '{"clientSlug":"demo","phone":"123"}'
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' -d '{"clientSlug":"nope","phone":"0501234567"}'

# real call (Dubai 09:00–18:00 only, otherwise 409)
curl -s -X POST $PUBLIC_URL/dial -H "x-api-key: $DIAL_API_KEY" -H 'content-type: application/json' \
  -d '{"clientSlug":"demo","name":"Anas","phone":"<your verified number>","property":"a 2-bed in Dubai Marina"}'
```
Expected: your phone rings within 60s (the Twilio trial plays a short notice first). Sara opens with your name and the property.
After hanging up, Supabase has `leads.qualification` / `leads.viewing` filled in, and a `calls` row with status, `ended_at` and transcript.

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
