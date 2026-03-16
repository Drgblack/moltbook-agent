import path from "node:path";

import dotenv from "dotenv";

import type { AppConfig } from "./types.js";

dotenv.config();

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dryRun = process.argv.includes("--dry-run");
  const draftReply = process.argv.includes("--draft-reply");
  const agentSignup = process.argv.includes("--agent-signup");
  const listPosts = process.argv.includes("--list-posts");
  const headlessArg = process.argv.includes("--headless");
  const postId = getArgValue("--post-id");

  return {
    moltbookUrl: process.env.MOLTBOOK_URL?.trim() || "https://moltbook.com",
    files: {
      postsPath: path.resolve(cwd, process.env.POSTS_FILE || "posts.json"),
      statePath: path.resolve(cwd, process.env.STATE_FILE || "state.json"),
      claimLinkPath: path.resolve(cwd, "claim-link.txt")
    },
    browser: {
      headed: !headlessArg && !isTruthy(process.env.BROWSER_HEADLESS),
      slowMoMs: Number(process.env.SLOW_MO_MS || 50)
    },
    cli: {
      dryRun,
      draftReply,
      agentSignup,
      listPosts,
      postId
    }
  };
}

export function printUsage(): void {
  console.log(`Usage:
  npm run post
  npm run post -- --post-id post-004
  npm run post:dry
  npm run agent:signup
  npm run reply:draft
  npm run list-posts`);
}
