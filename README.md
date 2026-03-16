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

## What it does

- loads posts from `posts.json`
- tracks used posts in `state.json`
- selects the first unused post by default
- shows the chosen post in the terminal before doing anything
- opens Moltbook in a headed Chromium browser
- supports manual takeover for login, captcha, or verification
- navigates to a composer using resilient selector fallbacks
- supports dry runs that stop before clicking publish
- asks for explicit terminal confirmation before every publish
- optionally scans the visible feed and drafts reply candidates for review only

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

## Manual takeover

The script supports manual takeover for:

- login
- captcha
- two-factor or verification prompts
- unstable selectors
- navigation that is easier to complete by hand

When prompted, complete the step in the browser and then return to the terminal to continue.

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
- there is no scheduler or background job support
- if selectors are uncertain, the script fails safely and tells you what to do manually

## Known limitations

- Moltbook selectors may change at any time
- the current selector strategy uses fallback candidates in `src/lib/moltbook.ts`
- login flow is intentionally not automated because captcha and verification are likely
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
- `npm run reply:draft`
- `npm run list-posts`
- `npm run typecheck`
