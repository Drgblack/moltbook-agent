import { loadConfig, printUsage } from "./config.js";
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
import { writeTextFile } from "./utils/fs.js";
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
        'Still on the Moltbook public landing page. Posting only works after agent signup, claim, and verification. Run "npm run agent:signup" first if the agent account has not been claimed yet.'
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

    // The client owns the final publish confirmation so the last approval happens right before click.
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
