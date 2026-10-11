# Phase 0 Demo Guide

Goal: Sara (the AI agent) phones **your own mobile**, qualifies you as a buyer, and saves the result in Supabase.
Total time: about 30 minutes. Do the steps in order.

**Already done:** the OpenAI key and Supabase keys are in `.env`, and the database tables and the demo agent "Sara" exist.

---

## Before you start: how calling UAE phones works

- **Twilio can call UAE mobiles.** Calls go from a Twilio **US number** to your **+971** phone. It costs about **$0.30/min** (Twilio's UAE price list).
- **Twilio won't sell you a UAE (+971) number to call *from*.** On a test call, the person you call sees a US number (+1…), or "Unknown".
- **That's fine for testing our own phones.** It isn't fine for real leads: people in the UAE often ignore foreign numbers. Before the first paying client, switch to a +971 caller ID (see "Going live" at the end).
- **Nothing is fully free.** Every provider charges about $0.27–0.36/min to call UAE mobiles. Use the free trial credit:

| Provider | Free trial credit | Rough test minutes* | Notes |
|---|---|---|---|
| **Twilio** (what the code uses) | yes (shown on signup) | ~30–50 min | Trial can only call **verified** numbers; adds a short "trial account" message |
| Plivo | $10, no card needed | ~35 min | Would need code changes. Local +971 number is $150/month |
| Telnyx | $5 | ~15 min | Would need code changes. Trial calls max 10 min, verified numbers only |

\* Telephony cost only. OpenAI realtime audio is charged separately to your OpenAI key.

**Plan:**
1. **Free, today, OpenAI key only:** talk to Sara in your browser (Step 0). This tests how she sounds and handles the conversation.
2. **Real phone calls:** Twilio trial credit + a US number (Steps 1–6). This tests the full system: phone ringing, data saved to Supabase.

---

## Step 0: Free test in the browser, OpenAI key only (5 min)
No Twilio, no ngrok, no code. You only pay OpenAI audio usage (a few cents per minute) on your existing key.
1. Open **platform.openai.com/playground/realtime** and log in with the account that owns your API key.
2. In the settings panel:
   - **Model:** `gpt-realtime-2.1` (or the mini model to save cost)
   - **Voice:** `verse` (what the demo agent uses; try others)
   - **Turn detection:** Semantic VAD
3. Open `docs/playground-prompt.md` in this repo. It's Sara's real prompt with the demo values filled in. Copy all of it into the **Instructions / System prompt** box.
4. Click **Start session**, allow the microphone, and say "Hello?" like you just picked up the phone. Sara should open with "Hi Anas! It's Sara from Marina Bay Realty…".
5. Run through the role-play scenarios in section 3 below (interrupting, "are you a robot?", asking the price, and so on).
   If Sara gets something wrong, edit `prompts/broker-base.md`. That's the file the real phone agent uses. Re-paste the changed text and try again.

What Step 0 **doesn't** test: the phone call itself, and saving to Supabase. Steps 1–6 cover those.

---

## Step 1: Supabase (2 min)
Open your Supabase project → **SQL Editor** → paste this → **Run**:
```sql
-- your company number = the human Sara hands over to
update agents set transfer_number = '+971542587669' where persona_name = 'Sara';

-- safety check on calling-hours format
alter table agents
  add constraint calling_start_hhmm check (calling_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_end_hhmm check (calling_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_window_same_day check (calling_start < calling_end);

select persona_name, transfer_number, calling_start, calling_end from agents;
```
✅ The last line shows `Sara | +971542587669 | 09:00 | 18:00`.

## Step 2: Twilio, the phone line (10 min)
1. Sign up free at **twilio.com**. If it asks what you're building, pick **Voice**.
2. **Phone Numbers → Manage → Verified Caller IDs → Add a new Caller ID**
   - Enter your own mobile in `+971…` format. Twilio calls it and you type in the code it reads out.
   - Repeat for **+971 54 258 7669** and for any friend's phone used in testing. **A trial account can only call verified numbers.**
3. **Phone Numbers → Manage → Buy a number** → Country: **United States**, Capability: **Voice** → Buy. The trial credit pays for it.
4. **Voice → Settings → Geo permissions** → tick **United Arab Emirates** → Save. Without this, calls to +971 are blocked.
5. On the Twilio **Console home page**, copy the **Account SID** (starts with `AC`) and the **Auth Token** (click "show").

✅ You have: Account SID, Auth Token, a US number like `+1 415 555 0123`.

## Step 3: ngrok, the public link to your laptop (5 min)
Twilio has to reach the program running on your laptop. ngrok gives your laptop a public web address.
1. Sign up free at **ngrok.com**. In the dashboard, copy your **authtoken**.
2. Also in the dashboard: **Domains → claim your free static domain**. This keeps the same address every time.
3. In PowerShell:
```
winget install ngrok.ngrok
ngrok config add-authtoken YOUR_TOKEN
ngrok http --url=YOUR-STATIC-DOMAIN.ngrok-free.app 5050
```
✅ It shows `Forwarding https://YOUR-STATIC-DOMAIN.ngrok-free.app -> http://localhost:5050`. **Leave this window open.**

## Step 4: Fill in `.env` (3 min)
Open `uae-voice-agent/.env`. Five lines are still empty. Fill them in:
```
TWILIO_ACCOUNT_SID=AC...                                  ← Step 2.5
TWILIO_AUTH_TOKEN=...                                     ← Step 2.5
TWILIO_FROM_NUMBER=+14155550123                           ← US number from Step 2.3, no spaces
PUBLIC_URL=https://YOUR-STATIC-DOMAIN.ngrok-free.app      ← Step 3, no "/" at the end
DIAL_API_KEY=                                             ← run the command below and paste the output
```
Make a `DIAL_API_KEY`:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Leave `REALTIME_MODEL` and `PORT` as they are. Never share `.env` or commit it (git already ignores it).

## Step 5: Start the agent (2 min)
Open a **second** terminal:
```
cd "C:\Users\Anas Altaf\Desktop\Development\uae-voice-agent"
npm install
npm test
npm run dev
```
✅ `npm test` shows all tests passed, and `npm run dev` shows `Server listening at http://0.0.0.0:5050`. **Leave it open.**

## Step 6: Make Sara call you (2 min)
Only between **09:00 and 18:00 Dubai time**. Open a **third** terminal, **Git Bash** this time:
```bash
cd ~/Desktop/Development/uae-voice-agent
set -a; source .env; set +a

curl -X POST $PUBLIC_URL/dial \
  -H "x-api-key: $DIAL_API_KEY" -H "content-type: application/json" \
  -d '{"clientSlug":"demo","name":"Anas","phone":"+9715XXXXXXXX","property":"a 2-bed in Dubai Marina"}'
```
Replace `+9715XXXXXXXX` with **your verified mobile**.

✅ The reply looks like `{"leadId":"…","callSid":"CA…"}`. Your phone rings within a minute, showing the US number.
Twilio plays a short trial message (press a key if it asks), then Sara says:
*"Hi Anas! It's Sara from Marina Bay Realty — you enquired about a 2-bed in Dubai Marina a few minutes ago…"*

Play a buyer and agree to a viewing, then hang up. In Supabase → **Table Editor**:
- `leads`: your row has `qualification` (buy/rent, budget, areas…) and `viewing` filled in
- `calls`: one row with `status = completed` and the `transcript`

## If something goes wrong
| What you see | What it means | Fix |
|---|---|---|
| `401` | Wrong or missing API key | Re-run `set -a; source .env; set +a` in Git Bash |
| `400 invalid_phone` | Number not recognised | Use `+9715…` or `05…` format |
| `409 outside_calling_hours` | Outside 09:00–18:00 Dubai | Wait, or for testing: `update agents set calling_end = '23:00';` in Supabase |
| `502 dial_failed` + a message | Twilio refused the call | Usually: number not verified (Step 2.2), UAE geo permission off (Step 2.4), or wrong `TWILIO_FROM_NUMBER` |
| `500 agent_misconfigured` | Agent settings incomplete | The agent's `prompt_vars` needs `areas` and `specialty` |
| Phone rings, then silence | Agent can't reach OpenAI or Twilio can't reach you | Check the `npm run dev` window for `realtime connect failed` (OpenAI key/credit) and make sure ngrok is still running with the same URL as `PUBLIC_URL` |
| Nothing at all | Server or ngrok is down | Both windows from Steps 3 and 5 must stay open |

Send the curl reply plus the red lines from the `npm run dev` window when asking for help.

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

## Going live: before the first paying client
Test calls from a US number are fine. Real leads need to see a **+971** number, or many won't pick up. The options, cheapest and most legitimate first:
1. **Your company's own du / Etisalat business line as a SIP trunk.** Ask du or e& for "SIP trunk for business" on the company trade license. Calls then show the company's real +971 number. Needs a small code change: Twilio *Elastic SIP Trunking* or OpenAI's direct SIP support instead of a Twilio number.
2. **A local +971 number from Telnyx or Plivo** (~$150/month, needs a UAE trade license plus the Emirates ID of the license holder). Needs a code change to that provider.
3. Keep Twilio and use the verified **+971 54 258 7669** as caller ID. Test it: UAE carriers often block or replace +971 caller IDs coming from abroad unless the number is allowlisted.

Put the per-minute cost (about $0.30/min telephony plus OpenAI audio) into the client's monthly price.
