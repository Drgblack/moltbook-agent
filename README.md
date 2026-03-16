# Moltbook Supervised Poster

A local-first TypeScript CLI for Moltbook using the official Moltbook API as the preferred integration path, with Playwright browser automation retained as a secondary fallback.

## Preferred integration

API-first is now the default recommendation for:

- agent registration
- agent status checks
- feed reads
- supervised post creation

Browser automation remains available for:

- fallback onboarding
- manual claim flows
- UI-only inspection
- reply drafting from the visible feed

## Core behaviour

- local JSON content in `posts.json`
- local JSON post state in `state.json`
- local JSON credentials in `credentials.json`
- no database
- no scheduler
- no background posting
- no automatic reply posting

Humans can observe Moltbook publicly, but agent accounts must be registered, claimed, and verified before posting succeeds.

## Setup

1. Install Node.js 18+.
2. Copy `.env.example` to `.env`.
3. Install dependencies:

```bash
npm install
```

4. Install Playwright browsers if you plan to use fallback browser mode:

```bash
npx playwright install chromium
```

## Configuration

Create a local `.env` file:

```env
MOLTBOOK_URL=https://moltbook.com
MOLTBOOK_API_BASE=https://www.moltbook.com/api/v1
MOLTBOOK_API_KEY=
MOLTBOOK_AGENT_NAME=ZazaDraftAgent
MOLTBOOK_AGENT_DESCRIPTION=AI agent studying how wording influences human reactions in teacher-parent communication. Interested in tone safety, escalation risk, and calm professional language.
BROWSER_HEADLESS=false
SLOW_MO_MS=50
POSTS_FILE=./posts.json
STATE_FILE=./state.json
```

Safety rule: API calls are restricted to `https://www.moltbook.com/api/v1`. The project refuses to send Moltbook API keys anywhere else.

## API-first commands

Register an agent through the API:

```bash
npm run agent:register
```

This calls `POST /agents/register`, prints any returned `api_key`, `claim_url`, and `verification_code`, and saves them to `credentials.json`.

Check agent claim status:

```bash
npm run agent:status
```

This calls `GET /agents/status` and reports whether the agent is `pending_claim` or `claimed`.

Post through the API:

```bash
npm run post:api
```

This:

- selects the first unused post unless `--post-id` is provided
- derives a short title
- asks for confirmation before sending
- calls `POST /posts`
- only marks the post as used if the API confirms success
- stops safely if the API reports a verification challenge

Read recent posts through the API:

```bash
npm run feed:api
```

This calls `GET /posts?sort=new&limit=10` and prints a compact readable summary.

## Claim and verification

Registration can return:

- `api_key`
- `claim_url`
- `verification_code`

The human operator must complete claim and verification manually. Posting may still require a verification challenge even after registration, and the tool does not attempt to solve that challenge automatically.

## Browser fallback commands

Fallback browser posting:

```bash
npm run post
```

Dry-run browser posting:

```bash
npm run post:dry
```

Browser-based agent signup helper:

```bash
npm run agent:signup
```

Reply drafting from the visible feed:

```bash
npm run reply:draft
```

List unused local posts:

```bash
npm run list-posts
```

## Browser fallback notes

Browser mode is fallback only now. The Moltbook public landing page can contain inputs or editable elements that resemble a composer, so browser posting refuses to continue unless it sees authenticated app context markers.

Use browser mode when:

- API registration succeeded but a human still needs to complete claim
- captcha or verification must be handled manually
- a UI-only inspection step is required

## Local files

- `posts.json`: source post content
- `state.json`: used post tracking
- `credentials.json`: saved API credentials from registration
- `claim-link.txt`: optional browser-captured claim link

## Updating posts

Edit `posts.json` directly. Each post should look like:

```json
{
  "id": "post-001",
  "type": "observation",
  "text": "Your post text here.",
  "source": "curated",
  "used": false
}
```

`state.json` remains the primary publish ledger.

## Safety model

- API-first integration is preferred
- browser automation is fallback only
- every post still requires terminal confirmation
- the tool never sends API keys anywhere except `https://www.moltbook.com/api/v1`
- missing credentials fail safely
- verification challenges are printed for a human to handle
- no unattended posting
- no automatic reply posting

## Known limitations

- exact Moltbook API response shapes may evolve, so the API client uses conservative field-detection heuristics
- posting may require a verification challenge that must be completed manually
- browser selectors may still need maintenance if the Moltbook UI changes

## Scripts

- `npm run dev`
- `npm run post`
- `npm run post:dry`
- `npm run post:api`
- `npm run agent:signup`
- `npm run agent:register`
- `npm run agent:status`
- `npm run feed:api`
- `npm run reply:draft`
- `npm run list-posts`
- `npm run typecheck`
