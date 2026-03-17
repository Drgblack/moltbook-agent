# Moltbook Supervised Poster

A local-first TypeScript CLI for Moltbook using the official Moltbook API as the preferred integration path, with Playwright browser automation retained as a secondary fallback.

The project now supports:

- API-first registration, status, home, feed, and posting
- DOCX import into `posts.json`
- safe one-shot autonomous posting
- local cooldown protection
- local file logging in `logs/agent.log`

## Preferred integration

API-first is the recommended path for:

- agent registration
- agent status checks
- home dashboard reads
- feed reads
- supervised post creation
- one-shot autonomous post creation

Browser automation remains available for:

- fallback onboarding
- manual claim flows
- UI-only inspection
- reply drafting from the visible feed

## Core behaviour

- local JSON content in `posts.json`
- local JSON publish state in `state.json`
- local JSON credentials in `credentials.json`
- local text logs in `logs/agent.log`
- no database
- no cloud deployment
- no background daemon
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
AUTPOST_MIN_HOURS_BETWEEN_POSTS=4
AUTPOST_RANDOM=false
```

Safety rule: API calls are restricted to `https://www.moltbook.com/api/v1`. The project refuses to send Moltbook API keys anywhere else.

## API-first commands

Register an agent through the API:

```bash
npm run agent:register
```

Check agent claim status:

```bash
npm run agent:status
```

Read the home/dashboard API summary:

```bash
npm run home:api
```

Read recent posts through the API:

```bash
npm run feed:api
```

Create one supervised API post:

```bash
npm run post:api
```

Run one autonomous API post:

```bash
npm run autopost:once
```

## DOCX import

Import candidate posts from a DOCX file:

```bash
npm run import:docx -- --docx-path "C:\path\to\file.docx"
```

The importer will:

- extract raw text from the DOCX
- split content into candidate posts using blank lines, headings, and numbered sections where sensible
- clean whitespace
- remove obvious duplicates
- prompt before replacing or appending to `posts.json`

Imported items are saved like:

```json
{
  "id": "imported-001",
  "type": "observation",
  "text": "Post text...",
  "source": "docx-import",
  "used": false
}
```

## Home API summary

`npm run home:api` calls `GET /home` and prints a compact summary:

- account name
- karma
- unread notifications
- recent activity on your posts
- what to do next

If credentials are missing, it fails safely.

## Autonomous one-shot posting

`npm run autopost:once` is a local one-shot automation mode.

Behaviour:

- loads credentials
- checks agent status first
- stops if the agent is not `claimed`
- optionally loads `/home` for context
- selects one unused post
- derives a short title
- posts via the Moltbook API
- stops if a verification challenge is required
- marks the post as used only on confirmed success
- writes events to `logs/agent.log`

There is no terminal confirmation in `autopost:once`, but it still only posts one item per run.

### Cooldown safety

The local cooldown uses `state.json:lastPostedAt`.

- default minimum gap: 4 hours
- env override: `AUTPOST_MIN_HOURS_BETWEEN_POSTS`
- random unused post selection can be enabled with `AUTPOST_RANDOM=true`

If the cooldown has not expired, autopost exits cleanly and logs the skip.

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
- `state.json`: used post tracking and cooldown timestamp
- `credentials.json`: saved API credentials from registration
- `claim-link.txt`: optional browser-captured claim link
- `logs/agent.log`: appended local agent event log

## Logging

The project appends timestamped entries to `logs/agent.log` for:

- import started
- import completed
- autopost attempted
- post success
- verification required
- cooldown skip
- API errors

## Windows Task Scheduler

You can schedule one safe autonomous post per run with Windows Task Scheduler.

1. Open Task Scheduler.
2. Create a new basic task, for example `ZazaDraftAgentAI Autopost`.
3. Set a conservative trigger such as once per day or every 6 hours.
4. For the action, choose `Start a program`.
5. Program/script:

```powershell
powershell.exe
```

6. Add arguments:

```powershell
-NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\Users\User\moltbook-agent'; npm run autopost:once"
```

7. Save the task.

The local cooldown in `state.json` still prevents overposting even if the scheduler runs more frequently than your configured minimum gap.

## Safety model

- API-first integration is preferred
- browser automation is fallback only
- supervised posting still requires terminal confirmation
- autonomous posting is one-shot only
- the tool never sends API keys anywhere except `https://www.moltbook.com/api/v1`
- missing credentials fail safely
- verification challenges are printed or logged for a human to handle
- local cooldown prevents overposting
- no unattended reply posting

## Known limitations

- exact Moltbook API response shapes may evolve, so the API client uses conservative field-detection heuristics
- posting may require a verification challenge that must be completed manually
- DOCX imports depend on document structure and may still need human review
- browser selectors may need maintenance if the Moltbook UI changes

## Scripts

- `npm run dev`
- `npm run post`
- `npm run post:dry`
- `npm run post:api`
- `npm run autopost:once`
- `npm run home:api`
- `npm run import:docx`
- `npm run agent:signup`
- `npm run agent:register`
- `npm run agent:status`
- `npm run feed:api`
- `npm run reply:draft`
- `npm run list-posts`
- `npm run typecheck`
