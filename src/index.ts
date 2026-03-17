import { loadConfig, printUsage } from "./config.js";
import { importPostsFromDocx } from "./lib/docx-import.js";
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
import type { CredentialsFile, FeedPostSummary, HomeSummary, Post } from "./types.js";
import { appendAgentLog } from "./utils/agent-log.js";
import { fileExists, readJsonFile, writeJsonFile, writeTextFile } from "./utils/fs.js";
import { HttpError } from "./utils/http.js";
import { logger } from "./utils/logger.js";
import { ask, askYesNo, closePrompt } from "./utils/prompt.js";

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

async function runImportDocxFlow(): Promise<void> {
  const config = loadConfig();
  const docxPath = config.cli.docxPath;

  if (!docxPath) {
    throw new Error('Missing --docx-path. Example: npm run import:docx -- --docx-path "C:\\path\\to\\file.docx"');
  }

  await appendAgentLog(config.files.logPath, "import-started", `DOCX import started from ${docxPath}`);

  const result = await importPostsFromDocx(docxPath);
  logger.divider("DOCX Import Preview");
  console.log(`Source file: ${docxPath}`);
  console.log(`Raw candidate blocks: ${result.rawBlockCount}`);
  console.log(`Unique imported posts: ${result.uniqueBlockCount}`);

  const existingPosts = (await fileExists(config.files.postsPath))
    ? await loadPosts(config.files.postsPath)
    : [];

  let finalPosts = result.posts;

  if (existingPosts.length > 0) {
    const choice = (
      await ask(
        `posts.json already contains ${existingPosts.length} items. Choose mode: [1] replace [2] append deduplicated [n] cancel `
      )
    )
      .trim()
      .toLowerCase();

    if (choice === "1") {
      const confirmed = await askYesNo("Replace posts.json with imported posts?", false);

      if (!confirmed) {
        logger.warn("DOCX import cancelled before replace.");
        await appendAgentLog(config.files.logPath, "import-completed", "DOCX import cancelled before replace");
        return;
      }
    } else if (choice === "2") {
      finalPosts = appendDeduplicatedPosts(existingPosts, result.posts);
    } else {
      logger.warn("DOCX import cancelled.");
      await appendAgentLog(config.files.logPath, "import-completed", "DOCX import cancelled");
      return;
    }
  } else {
    const confirmed = await askYesNo("Write imported posts to posts.json?", false);

    if (!confirmed) {
      logger.warn("DOCX import cancelled.");
      await appendAgentLog(config.files.logPath, "import-completed", "DOCX import cancelled");
      return;
    }
  }

  await writeJsonFile(config.files.postsPath, finalPosts);
  logger.success(`Saved ${finalPosts.length} posts to ${config.files.postsPath}`);
  await appendAgentLog(
    config.files.logPath,
    "import-completed",
    `DOCX import completed from ${docxPath}; saved ${finalPosts.length} posts`
  );
}

async function runPostingFlow(): Promise<void> {
  const config = loadConfig();
  const [posts, state] = await Promise.all([
    loadPosts(config.files.postsPath),
    loadState(config.files.statePath)
  ]);

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
        "Manual takeover active. Log in to Moltbook as ZazaDraftAgentAI, complete any checks, and navigate if needed."
      );
    }

    const context = await client.inspectPostingContext();
    logger.info(`Current Moltbook URL: ${context.currentUrl}`);

    if (context.onLandingPage) {
      throw new Error(
        'Still on the Moltbook public landing page. Posting only works after agent signup, claim, and verification. Prefer "npm run post:api" or "npm run autopost:once" once credentials are ready.'
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
  let result;

  try {
    result = await client.registerAgent(config.api.agentName, config.api.agentDescription);
  } catch (error: unknown) {
    handleRegistrationConflict(error);
    throw error;
  }

  logger.divider("Agent Registration");
  console.log(`Agent name: ${config.api.agentName}`);
  console.log(`API key: ${result.apiKey ?? "[not returned]"}`);
  console.log(`Claim URL: ${result.claimUrl ?? "[not returned]"}`);
  console.log(`Verification code: ${result.verificationCode ?? "[not returned]"}`);

  if (!result.apiKey) {
    const responseShape = safeFormatJson(result.raw);
    throw new Error(
      `The Moltbook API did not return an api_key in either the top-level response or nested agent object. credentials.json was not written. Raw response: ${responseShape}`
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

async function runAgentRegisterDebugFlow(): Promise<void> {
  const config = loadConfig();
  const client = new MoltbookApiClient(config.api.base);

  logger.divider("Agent Register Debug");
  console.log(`Agent name: ${config.api.agentName}`);

  try {
    const result = await client.registerAgent(config.api.agentName, config.api.agentDescription);
    console.log(safeFormatJson(result.raw));
    logger.warn("Debug mode never writes credentials.json.");
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      if (error.status === 409) {
        logger.warn(
          "Registration conflict: this agent name may already be registered. Stop retrying registration and recover the original credentials or use the existing claimed agent."
        );
        logger.divider("Conflict Response");
        console.log(safeFormatJson(error.body));
        return;
      }

      logger.divider("Raw Error Response");
      console.log(safeFormatJson(error.body));
      throw error;
    }

    throw error;
  }
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

async function runHomeApiFlow(): Promise<void> {
  const config = loadConfig();
  const apiKey = await resolveApiKey(config.files.credentialsPath, config.api.apiKey);
  const client = new MoltbookApiClient(config.api.base, apiKey);
  const home = await client.fetchHome();

  logger.divider("Home Summary");
  printHomeSummary(home);
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

async function runAutopostOnceFlow(): Promise<void> {
  const config = loadConfig();
  await appendAgentLog(config.files.logPath, "autopost-attempted", "Autopost run started");

  const apiKey = await resolveApiKey(config.files.credentialsPath, config.api.apiKey);
  const client = new MoltbookApiClient(config.api.base, apiKey);
  const status = await client.getAgentStatus();

  if (status.status !== "claimed") {
    logger.warn(`Autopost stopped because agent status is ${status.status}.`);
    await appendAgentLog(
      config.files.logPath,
      "api-error",
      `Autopost stopped because agent status is ${status.status}`
    );
    return;
  }

  const state = await loadState(config.files.statePath);
  const cooldownMessage = getCooldownMessage(
    state.lastPostedAt,
    config.automation.minHoursBetweenPosts
  );

  if (cooldownMessage) {
    logger.warn(cooldownMessage);
    await appendAgentLog(config.files.logPath, "cooldown-skip", cooldownMessage);
    return;
  }

  const posts = await loadPosts(config.files.postsPath);
  const unusedPosts = getUnusedPosts(posts, state);

  if (unusedPosts.length === 0) {
    logger.warn("Autopost stopped because no unused posts remain.");
    await appendAgentLog(config.files.logPath, "api-error", "Autopost stopped because no unused posts remain");
    return;
  }

  try {
    const home = await client.fetchHome();
    logger.info(
      `Autopost context: account=${home.accountName || "unknown"} karma=${home.karma ?? "unknown"}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Home context lookup failed. Continuing without it. ${message}`);
  }

  const chosenPost = chooseAutopostPost(unusedPosts, config.automation.randomSelection);
  const title = deriveShortTitle(chosenPost);
  const result = await client.createPost(title, chosenPost.text, config.api.submoltName);

  if (result.verificationRequired) {
    logger.warn("Autopost stopped because the API requested verification.");
    console.log(result.challengeDetails ?? "[challenge details not provided]");
    await appendAgentLog(
      config.files.logPath,
      "verification-required",
      result.challengeDetails ?? "Verification challenge required during autopost"
    );
    return;
  }

  if (!result.success) {
    throw new Error("Autopost failed because the API did not confirm post creation.");
  }

  await recordPublishedPost(config.files.postsPath, config.files.statePath, chosenPost.id);
  logger.success(`Autopost published ${chosenPost.id}${result.postId ? ` as ${result.postId}` : ""}.`);
  await appendAgentLog(
    config.files.logPath,
    "post-success",
    `Autopost published ${chosenPost.id}${result.postId ? ` as ${result.postId}` : ""}`
  );
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

    for (const candidate of candidates) {
      console.log(`${candidate.title}: ${candidate.text}\n`);
    }

    logger.info("Reply drafting mode never posts automatically.");
  } finally {
    await client.close();
  }
}

function chooseAutopostPost(posts: Post[], randomSelection: boolean): Post {
  if (!randomSelection) {
    return posts[0];
  }

  const index = Math.floor(Math.random() * posts.length);
  return posts[index];
}

function deriveShortTitle(post: Post): string {
  const firstSentence = post.text.split(/[.!?]/)[0]?.trim() || post.text.trim();
  const collapsed = firstSentence.replace(/\s+/g, " ");

  if (collapsed.length <= 72) {
    return collapsed;
  }

  return `${collapsed.slice(0, 69).trim()}...`;
}

function appendDeduplicatedPosts(existingPosts: Post[], importedPosts: Post[]): Post[] {
  const existingKeys = new Set(existingPosts.map((post) => normalisePostText(post.text)));
  const maxImportedNumber = existingPosts.reduce((max, post) => {
    const match = post.id.match(/^imported-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  const dedupedNewPosts = importedPosts
    .filter((post) => !existingKeys.has(normalisePostText(post.text)))
    .map((post, index) => ({
      ...post,
      id: `imported-${String(maxImportedNumber + index + 1).padStart(3, "0")}`
    }));

  return [...existingPosts, ...dedupedNewPosts];
}

function normalisePostText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getCooldownMessage(lastPostedAt: string | null, minHoursBetweenPosts: number): string | null {
  if (!lastPostedAt) {
    return null;
  }

  const lastPostedMs = Date.parse(lastPostedAt);

  if (Number.isNaN(lastPostedMs)) {
    return null;
  }

  const hoursSinceLastPost = (Date.now() - lastPostedMs) / (1000 * 60 * 60);

  if (hoursSinceLastPost >= minHoursBetweenPosts) {
    return null;
  }

  return `Autopost skipped because the last post was ${hoursSinceLastPost.toFixed(2)} hours ago, below the ${minHoursBetweenPosts}-hour cooldown.`;
}

function printHomeSummary(home: HomeSummary): void {
  console.log(`Account name: ${home.accountName || "unknown"}`);
  console.log(`Karma: ${home.karma ?? "unknown"}`);
  console.log(`Unread notifications: ${home.unreadNotifications ?? "unknown"}`);
  console.log(
    `Recent activity: ${home.recentActivity.length > 0 ? home.recentActivity.join(" | ") : "none returned"}`
  );
  console.log(
    `What to do next: ${home.whatToDoNext.length > 0 ? home.whatToDoNext.join(" | ") : "none returned"}`
  );
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

function safeFormatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function handleRegistrationConflict(error: unknown): void {
  if (error instanceof HttpError && error.status === 409) {
    logger.warn(
      "Registration conflict: this agent name may already be registered. Stop retrying registration and recover the original credentials or use the existing claimed agent."
    );
    logger.divider("Conflict Response");
    console.log(safeFormatJson(error.body));
  }
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

  if (config.cli.importDocx) {
    await runImportDocxFlow();
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

  if (config.cli.agentRegisterDebug) {
    await runAgentRegisterDebugFlow();
    return;
  }

  if (config.cli.agentStatus) {
    await runAgentStatusFlow();
    return;
  }

  if (config.cli.homeApi) {
    await runHomeApiFlow();
    return;
  }

  if (config.cli.postApi) {
    await runApiPostingFlow();
    return;
  }

  if (config.cli.autopostOnce) {
    await runAutopostOnceFlow();
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
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);

    try {
      const config = loadConfig();
      await appendAgentLog(config.files.logPath, "api-error", message);
    } catch {
      // Best-effort logging only.
    }

    process.exitCode = 1;
  })
  .finally(() => {
    closePrompt();
  });
