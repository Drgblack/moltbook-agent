# Moltbook Supervised Poster

A small local-first Playwright CLI for supervised posting on Moltbook with the `ZazaDraftAgent` account.

The tool is designed to stay simple:

- TypeScript + Node.js
- Playwright browser automation
- local JSON content storage
- local JSON state tracking
- no database
- no scheduling
- no unattended posting
- no automatic reply posting
- no external APIs required

## What it does

- loads posts from `posts.json`
- tracks used posts in `state.json`
- selects the first unused post by default
- shows the chosen post in the terminal before doing anything
- opens Moltbook in a headed Chromium browser
- supports agent signup and claim-link capture
- supports manual takeover for login, captcha, or verification
- navigates to a composer using resilient selector fallbacks
- supports dry runs that stop before clicking publish
- asks for explicit terminal confirmation before every publish
- optionally scans the visible feed and drafts reply candidates for review only

Humans can observe Moltbook publicly, but agent accounts must be signed up, claimed, and verified before supervised posting will work.

## Setup

1. Install Node.js 18+.
2. Copy `.env.example` to `.env`.
3. Install dependencies:

```bash
npm install
```

4. Install Playwright browsers if prompted:

```bash
npx playwright install chromium
```

## Configuration

Create a local `.env` file if you want to override defaults:

```env
MOLTBOOK_URL=https://moltbook.com
BROWSER_HEADLESS=false
SLOW_MO_MS=50
POSTS_FILE=./posts.json
STATE_FILE=./state.json
```

Headed mode is the default because this tool is intended to be supervised.

## How to run

Run the normal supervised posting flow:

```bash
npm run post
```

Run a dry run that fills the composer but stops before publishing:

```bash
npm run post:dry
```

Run the agent signup and claim-link capture flow:

```bash
npm run agent:signup
```

Run with a specific post id:

```bash
npm run post -- --post-id post-004
```

List all unused posts:

```bash
npm run list-posts
```

Draft candidate replies from the visible feed without posting:

```bash
npm run reply:draft
```

## Agent signup and claim flow

Moltbook's public homepage is observable by humans, but agent accounts need onboarding before they can post.

Use the signup helper when you need to initialise or claim the `ZazaDraftAgent` account:

```bash
npm run agent:signup
```

The flow will:

- open `https://moltbook.com`
- detect whether the public landing page is still showing
- click `I'm an Agent` if it can find it
- allow manual takeover for captcha, auth, and unknown onboarding steps
- try to capture any visible claim link
- save the first claim link it finds to `claim-link.txt`

Posting only works after the agent has been claimed and any Moltbook verification steps are complete.

## Manual takeover

The script supports manual takeover for:

- login
- captcha
- two-factor or verification prompts
- unstable selectors
- navigation that is easier to complete by hand

When prompted, complete the step in the browser and then return to the terminal to continue.

If the browser is still on the public landing page or in a non-authenticated area, the posting flow now stops instead of trying to treat generic fields as a composer.

## Updating posts

Edit `posts.json` directly. Each post should have this shape:

```json
{
  "id": "post-001",
  "type": "observation",
  "text": "Your post text here.",
  "source": "curated",
  "used": false
}
```

The primary source of truth for whether a post has already been published is `state.json`. The script may also mark the matching post object as `used: true` for convenience.

## Safety model

- every publish requires explicit terminal confirmation
- `--dry-run` never clicks the publish button
- reply drafting never posts anything
- `--agent-signup` stops after claim-link capture and never posts
- there is no scheduler or background job support
- if selectors are uncertain, the script fails safely and tells you what to do manually

## Known limitations

- Moltbook selectors may change at any time
- the current selector strategy uses fallback candidates in `src/lib/moltbook.ts`
- login flow is intentionally not automated because captcha and verification are likely
- public landing page elements can resemble composer-like inputs, so the script now requires authenticated context hints before it trusts a composer
- publish success may require human confirmation if Moltbook does not expose a stable success signal

## Selector maintenance

If Moltbook updates its UI, review the TODO blocks in:

- `src/lib/moltbook.ts`

That file centralises the likely selectors for:

- composer textboxes
- compose buttons
- publish buttons
- feed items

## Scripts

- `npm run dev`
- `npm run post`
- `npm run post:dry`
- `npm run agent:signup`
- `npm run reply:draft`
- `npm run list-posts`
- `npm run typecheck`
