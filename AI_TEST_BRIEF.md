# Risk Intelligence Index — AI Features Test Proposal

## TL;DR

We've built four AI-powered features into the dashboard. Activating them costs money — about **$2.50 to $4 per day** at expected usage. Before committing to a longer-term budget, we want to spend **$15 once** as a 2-week test to see real numbers on cost and user value.

The system has **five separate layers** of cost protection. **You cannot spend more than $15** on this test. There is no auto-reload, no hidden fee, no path to overspend.

---

## What the AI features do

The dashboard already shows live prediction markets, news, and economic indicators. The AI features add interpretation on top of that data:

| Feature | What the user sees |
|---|---|
| **Side-Panel Briefing** | Click any signal card (a Bitcoin price marker, an Iran conflict marker, etc.). AI generates a trend chart, 3 driver bullets, and a "what to watch next" event pointer. |
| **AI Platforms Consensus** | For each market, shows how seven major AI platforms (Claude, GPT-4, Gemini, Grok, DeepSeek, Mistral, Perplexity) would each predict the same probability. Shows where they agree and where they diverge. |
| **VIX Driver Explainer** | The volatility-index card displays a 2-3 sentence "what's pushing the VIX today" summary, auto-refreshing every 30 minutes during market hours. |
| **Pulse Survey Generator** | Users can click any signal to generate 5 plain-English survey questions for their team. Tests organizational awareness of a risk. |

All four are already built. They are currently disabled because they require an Anthropic API key. Activation is a single config change.

---

## What it costs

Cost is per AI API call. Heavy caching means most user clicks don't trigger a new call.

| Feature | Per AI call | Expected daily cost |
|---|---|---|
| Side-Panel Briefing | $0.010 | $1.00 – $1.50 |
| AI Platforms Consensus | $0.007 | $1.00 – $1.50 |
| VIX Driver Explainer | $0.003 | $0.20 – $0.25 |
| Pulse Survey | $0.010 | $0.30 – $0.80 |
| **Total** | | **$2.50 – $4.00 / day** ≈ **$75 – $120 / month** |

These are projections based on similar dashboards. Actual numbers depend on how many users click and how often.

---

## Why we want a $15 test before committing more

Two reasons:

1. **Validate the cost model.** $75/month is a projection, not a measurement. The test gives us real numbers from our actual users.
2. **Validate the value.** Some features will get used a lot, others won't. The test data tells us which features earn their cost — so the decision afterward is "scale up the useful ones, kill the rest" rather than "approve a bigger budget on faith."

$15 covers anywhere from **5 days (worst case) to 15 days (expected)** of full activation. After that we have data, we make the next call.

---

## What protects us from overspending — five layers

1. **Reduced AI response sizes** — Backend uses tighter limits during the test, saving ~25% per call vs. specification.

2. **Per-user rate limit** — Any single visitor (or scraping bot) can only make 10 AI requests per minute. Anything beyond that gets a friendly "wait a moment" response.

3. **Server-side daily spending cap** — Our backend tracks every AI call's cost. Once daily spend reaches **$1.50**, the backend refuses further AI requests until midnight Eastern Time. Doesn't depend on Anthropic's systems — runs in our own code.

4. **Anthropic monthly hard cap** — In the Anthropic billing console, monthly spend limit is set to **$15**. Anthropic itself refuses calls past that. This is an independent ceiling regardless of what our backend does.

5. **Account balance** — Only $15 is deposited. Auto-reload is **off**. There is no card on file to charge beyond the deposit.

**Stack-up: any one of those five would have to fail catastrophically AND the other four would have to fail silently for any overspend to be possible. With auto-reload off, there is no charge mechanism even then.**

---

## Real-time visibility

We have a built-in monitoring endpoint that reports, at any moment:

- How much we've spent today
- How much budget remains today
- Total AI calls and how many were cached (didn't cost anything)
- Cache hit ratio (the higher this is, the more cost-efficient scaling becomes)

Anyone with the URL can check this from a browser. No Anthropic console login required.

---

## What we'll know after 14 days

| Question | We'll have measured |
|---|---|
| Are users actually using the AI features? | Yes / no per feature, with usage counts |
| What's the actual daily cost? | Real average, not estimate |
| Is caching paying off? | Cache hit ratio percentage |
| Which feature is highest value? | Per-feature usage and cost |
| Should we scale up, kill features, or stop? | Data-driven decision |

---

## Decision needed

Approve **$15 in one-time Anthropic API credit** to activate four AI-powered features for a 2-week test phase.

After 14 days we make the longer-term call with real data.

---

## How to approve

Whoever holds the company card / Anthropic account:

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. **Plans & Billing** → Add $15 credit. **Auto-reload: OFF.**
3. **Settings → Limits** → set monthly spend limit to **$15** (this is the hard ceiling).
4. Reply "approved" — engineering will paste the API key into the live deployment and the test phase begins.

To stop the test at any point: delete the API key from the deployment. Features instantly return to their "AI pending — connect Anthropic API" placeholder. No code change required.
