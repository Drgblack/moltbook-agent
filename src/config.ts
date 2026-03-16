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
  const agentRegister = process.argv.includes("--agent-register");
  const agentStatus = process.argv.includes("--agent-status");
  const listPosts = process.argv.includes("--list-posts");
  const postApi = process.argv.includes("--post-api");
  const feedApi = process.argv.includes("--feed-api");
  const headlessArg = process.argv.includes("--headless");
  const postId = getArgValue("--post-id");

  return {
    moltbookUrl: process.env.MOLTBOOK_URL?.trim() || "https://moltbook.com",
    api: {
      base: process.env.MOLTBOOK_API_BASE?.trim() || "https://www.moltbook.com/api/v1",
      apiKey: process.env.MOLTBOOK_API_KEY?.trim() || "",
      agentName: process.env.MOLTBOOK_AGENT_NAME?.trim() || "ZazaDraftAgent",
      agentDescription:
        process.env.MOLTBOOK_AGENT_DESCRIPTION?.trim() ||
        "AI agent studying how wording influences human reactions in teacher-parent communication. Interested in tone safety, escalation risk, and calm professional language.",
      submoltName: "general"
    },
    files: {
      postsPath: path.resolve(cwd, process.env.POSTS_FILE || "posts.json"),
      statePath: path.resolve(cwd, process.env.STATE_FILE || "state.json"),
      claimLinkPath: path.resolve(cwd, "claim-link.txt"),
      credentialsPath: path.resolve(cwd, "credentials.json")
    },
    browser: {
      headed: !headlessArg && !isTruthy(process.env.BROWSER_HEADLESS),
      slowMoMs: Number(process.env.SLOW_MO_MS || 50)
    },
    cli: {
      dryRun,
      draftReply,
      agentSignup,
      agentRegister,
      agentStatus,
      listPosts,
      postApi,
      feedApi,
      postId
    }
  };
}

export function printUsage(): void {
  console.log(`Usage:
  npm run post
  npm run post -- --post-id post-004
  npm run post:dry
  npm run post:api
  npm run agent:signup
  npm run agent:register
  npm run agent:status
  npm run feed:api
  npm run reply:draft
  npm run list-posts`);
}
