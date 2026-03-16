import { loadConfig, printUsage } from "./config.js";
import { MoltbookApiClient } from "./lib/moltbook-api.js";
import {
  draftReplyCandidates,
  formatPost,
  getUnusedPosts,
  loadPosts,
  loadState,
  recordPublishedPost,
  selectPost
} from "./lib/posts.js";
import { MoltbookClient } from "./lib/moltbook.js";
import type { CredentialsFile, FeedPostSummary, Post } from "./types.js";
import { fileExists, readJsonFile, writeJsonFile, writeTextFile } from "./utils/fs.js";
import { logger } from "./utils/logger.js";
import { askYesNo, closePrompt } from "./utils/prompt.js";

async function runListPosts(postsPath: string, statePath: string): Promise<void> {
  const [posts, state] = await Promise.all([loadPosts(postsPath), loadState(statePath)]);
  const unusedPosts = getUnusedPosts(posts, state);

  logger.divider("Unused Posts");

  if (unusedPosts.length === 0) {
    logger.warn("No unused posts remain.");
    return;
  }

  for (const post of unusedPosts) {
    console.log(`${post.id} | ${post.type} | ${post.text}`);
  }
}

async function runPostingFlow(): Promise<void> {
  const config = loadConfig();
  const [posts, state] = await Promise.all([
    loadPosts(config.files.postsPath),
    loadState(config.files.statePath)
  ]);

  // The first unused post is the safe default unless the operator explicitly targets one.
  const post = selectPost(posts, state, config.cli.postId);

  logger.divider("Chosen Post");
  console.log(formatPost(post));
  logger.divider();

  const continueToBrowser = await askYesNo("Continue to browser?", false);
  if (!continueToBrowser) {
    logger.warn("Stopped before opening the browser.");
    return;
  }

  const client = new MoltbookClient({
    url: config.moltbookUrl,
    headed: config.browser.headed,
    slowMoMs: config.browser.slowMoMs
  });

  try {
    await client.launch();

    const needsManualTakeover = await askYesNo(
      "Pause for manual takeover now for login, captcha, or verification?",
      true
    );

    if (needsManualTakeover) {
      await client.pauseForManualStep(
        "Manual takeover active. Log in to Moltbook as ZazaDraftAgent, complete any checks, and navigate if needed."
      );
    }

    const context = await client.inspectPostingContext();
    logger.info(`Current Moltbook URL: ${context.currentUrl}`);

    if (context.onLandingPage) {
      throw new Error(
        'Still on the Moltbook public landing page. Posting only works after agent signup, claim, and verification. Prefer "npm run post:api" once credentials are ready, or use "npm run agent:signup" for browser onboarding.'
      );
    }

    if (!context.likelyAuthenticated) {
      throw new Error(
        `Authenticated Moltbook agent UI was not detected. Logged-in markers found: ${context.loggedInAgentMarkers.join(", ") || "none"}. Stop here and complete login or claim verification manually before posting.`
      );
    }

    if (!context.likelyValidComposerContext) {
      throw new Error(
        `The script is not yet inside a trusted posting context. Current URL: ${context.currentUrl}. Logged-in markers found: ${context.loggedInAgentMarkers.join(", ") || "none"}. Navigate further into the authenticated app before posting.`
      );
    }

    // Browser posting remains available, but the API path is now preferred.
    const result = await client.createPost(post.text, config.cli.dryRun);

    if (result.published) {
      await recordPublishedPost(config.files.postsPath, config.files.statePath, post.id);
      logger.success(`Post ${post.id} recorded as used in state.json.`);
      return;
    }

    if (result.reason === "dry-run") {
      logger.info("Dry run completed. No files were updated.");
      return;
    }

    logger.warn(`Posting flow ended without a confirmed publish. Reason: ${result.reason}`);
  } finally {
    await client.close();
  }
}

async function runAgentSignupFlow(): Promise<void> {
  const config = loadConfig();
  const client = new MoltbookClient({
    url: "https://moltbook.com",
    headed: config.browser.headed,
    slowMoMs: config.browser.slowMoMs
  });

  try {
    await client.launch();

    const onLandingPage = await client.isLikelyLandingPage();
    logger.info(
      onLandingPage
        ? "Public Moltbook landing page detected."
        : `Landing page markers were not conclusive. Current URL: ${client.getCurrentUrl()}`
    );

    const clickedAgentEntry = await client.clickAgentSignupEntry();
    if (clickedAgentEntry) {
      logger.success('Clicked "I\'m an Agent".');
    } else {
      logger.warn('Could not find an "I\'m an Agent" entry automatically. Use manual takeover.');
    }

    await client.pauseForManualStep(
      "Manual takeover active. Complete captcha, auth, and any agent onboarding steps until a claim link or claim screen is visible."
    );

    const claimLink = await client.captureClaimLink();

    logger.divider("Claim Link");
    if (!claimLink) {
      logger.warn(
        `No claim link was detected on screen. Current URL: ${client.getCurrentUrl()}. If the claim link is visible but not machine-readable, copy it manually.`
      );
      return;
    }

    console.log(claimLink);
    await writeTextFile(config.files.claimLinkPath, `${claimLink}\n`);
    logger.success(`Claim link saved to ${config.files.claimLinkPath}`);
  } finally {
    await client.close();
  }
}

async function runAgentRegisterFlow(): Promise<void> {
  const config = loadConfig();

  if (await fileExists(config.files.credentialsPath)) {
    const overwrite = await askYesNo(
      `credentials.json already exists at ${config.files.credentialsPath}. Overwrite it?`,
      false
    );

    if (!overwrite) {
      logger.warn("Registration cancelled before overwriting credentials.json.");
      return;
    }
  }

  const client = new MoltbookApiClient(config.api.base);
  const result = await client.registerAgent(config.api.agentName, config.api.agentDescription);

  logger.divider("Agent Registration");
  console.log(`Agent name: ${config.api.agentName}`);
  console.log(`API key: ${result.apiKey ?? "[not returned]"}`);
  console.log(`Claim URL: ${result.claimUrl ?? "[not returned]"}`);
  console.log(`Verification code: ${result.verificationCode ?? "[not returned]"}`);

  if (!result.apiKey) {
    throw new Error(
      "The Moltbook API did not return an api_key. credentials.json was not written because the registration response is incomplete."
    );
  }

  const credentials: CredentialsFile = {
    api_base: config.api.base,
    api_key: result.apiKey,
    claim_url: result.claimUrl ?? undefined,
    verification_code: result.verificationCode ?? undefined,
    agent_name: config.api.agentName,
    agent_description: config.api.agentDescription,
    saved_at: new Date().toISOString()
  };

  await writeJsonFile(config.files.credentialsPath, credentials);
  logger.success(`Credentials saved to ${config.files.credentialsPath}`);
}

async function runAgentStatusFlow(): Promise<void> {
  const config = loadConfig();
  const apiKey = await resolveApiKey(config.files.credentialsPath, config.api.apiKey);
  const client = new MoltbookApiClient(config.api.base, apiKey);
  const result = await client.getAgentStatus();

  logger.divider("Agent Status");
  console.log(`Status: ${result.status}`);

  if (result.status === "pending_claim") {
    logger.warn("Agent is still pending claim. A human must complete the claim/verification flow.");
    return;
  }

  if (result.status === "claimed") {
    logger.success("Agent is claimed.");
    return;
  }

  logger.warn(`Unexpected status returned by the API: ${result.status}`);
}

async function runApiPostingFlow(): Promise<void> {
  const config = loadConfig();
  const [posts, state] = await Promise.all([
    loadPosts(config.files.postsPath),
    loadState(config.files.statePath)
  ]);
  const post = selectPost(posts, state, config.cli.postId);
  const apiKey = await resolveApiKey(config.files.credentialsPath, config.api.apiKey);
  const client = new MoltbookApiClient(config.api.base, apiKey);
  const title = deriveShortTitle(post);

  logger.divider("Chosen API Post");
  console.log(`ID: ${post.id}`);
  console.log(`Title: ${title}`);
  console.log(`Submolt: ${config.api.submoltName}`);
  console.log("");
  console.log(post.text);
  logger.divider();

  const proceed = await askYesNo("Send this post through the Moltbook API?", false);
  if (!proceed) {
    logger.warn("API posting cancelled before request.");
    return;
  }

  const result = await client.createPost(title, post.text, config.api.submoltName);

  if (result.verificationRequired) {
    logger.warn("The API reported a verification challenge. No post was marked as used.");
    logger.divider("Verification Challenge");
    console.log(result.challengeDetails ?? "[challenge details not provided]");
    return;
  }

  if (!result.success) {
    throw new Error("The Moltbook API did not confirm post creation.");
  }

  await recordPublishedPost(config.files.postsPath, config.files.statePath, post.id);
  logger.success(`API post succeeded${result.postId ? ` with id ${result.postId}` : ""}.`);
  logger.success(`Post ${post.id} recorded as used in state.json.`);
}

async function runFeedApiFlow(): Promise<void> {
  const config = loadConfig();
  const apiKey = await resolveApiKey(config.files.credentialsPath, config.api.apiKey);
  const client = new MoltbookApiClient(config.api.base, apiKey);
  const posts = await client.fetchFeed(10);

  logger.divider("Recent Moltbook Posts");

  if (posts.length === 0) {
    logger.warn("No posts were returned by the API.");
    return;
  }

  posts.forEach((post, index) => {
    console.log(formatFeedSummary(post, index + 1));
    console.log("");
  });
}

async function runDraftReplyFlow(): Promise<void> {
  const config = loadConfig();
  const client = new MoltbookClient({
    url: config.moltbookUrl,
    headed: config.browser.headed,
    slowMoMs: config.browser.slowMoMs
  });

  try {
    await client.launch();
    await client.pauseForManualStep(
      "Manual takeover active. Log in if needed, then navigate to the feed area you want to review."
    );

    const feedTexts = await client.collectVisibleFeedTexts(5);

    logger.divider("Visible Feed Text");
    if (feedTexts.length === 0) {
      logger.warn("No feed text was collected. Reply drafting will use a generic fallback prompt.");
    } else {
      feedTexts.forEach((text, index) => {
        console.log(`${index + 1}. ${text}\n`);
      });
    }

    const candidates = draftReplyCandidates(feedTexts);
    logger.divider("Draft Reply Candidates");

    // Drafts are displayed only; this mode deliberately has no posting path.
    for (const candidate of candidates) {
      console.log(`${candidate.title}: ${candidate.text}\n`);
    }

    logger.info("Reply drafting mode never posts automatically.");
  } finally {
    await client.close();
  }
}

function deriveShortTitle(post: Post): string {
  const firstSentence = post.text.split(/[.!?]/)[0]?.trim() || post.text.trim();
  const collapsed = firstSentence.replace(/\s+/g, " ");

  if (collapsed.length <= 72) {
    return collapsed;
  }

  return `${collapsed.slice(0, 69).trim()}...`;
}

function formatFeedSummary(post: FeedPostSummary, index: number): string {
  const summary = post.content.replace(/\s+/g, " ").trim();
  const excerpt = summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;

  return [
    `${index}. ${post.title || "[untitled]"}`,
    `   Author: ${post.authorName || "unknown"}`,
    `   Submolt: ${post.submoltName || "unknown"}`,
    `   Created: ${post.createdAt || "unknown"}`,
    `   ${excerpt}`
  ].join("\n");
}

async function resolveApiKey(credentialsPath: string, envApiKey: string): Promise<string> {
  if (envApiKey) {
    return envApiKey;
  }

  if (!(await fileExists(credentialsPath))) {
    throw new Error(
      `MOLTBOOK_API_KEY is missing and ${credentialsPath} does not exist. Run "npm run agent:register" first or set MOLTBOOK_API_KEY.`
    );
  }

  const credentials = await readJsonFile<Partial<CredentialsFile>>(credentialsPath);

  if (!credentials.api_key) {
    throw new Error(
      `credentials.json at ${credentialsPath} does not contain api_key. Run "npm run agent:register" again or set MOLTBOOK_API_KEY.`
    );
  }

  return credentials.api_key;
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  if (config.cli.listPosts) {
    await runListPosts(config.files.postsPath, config.files.statePath);
    return;
  }

  if (config.cli.agentRegister) {
    await runAgentRegisterFlow();
    return;
  }

  if (config.cli.agentStatus) {
    await runAgentStatusFlow();
    return;
  }

  if (config.cli.postApi) {
    await runApiPostingFlow();
    return;
  }

  if (config.cli.feedApi) {
    await runFeedApiFlow();
    return;
  }

  if (config.cli.agentSignup) {
    await runAgentSignupFlow();
    return;
  }

  if (config.cli.draftReply) {
    await runDraftReplyFlow();
    return;
  }

  await runPostingFlow();
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompt();
  });
