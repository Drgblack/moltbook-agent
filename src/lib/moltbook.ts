import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import type { PostingContextAssessment, PublishResult } from "../types.js";
import { logger } from "../utils/logger.js";
import { askYesNo, pause } from "../utils/prompt.js";

interface MoltbookClientOptions {
  url: string;
  headed: boolean;
  slowMoMs: number;
}

interface LocatorCandidate {
  name: string;
  build: (page: Page) => Locator;
}

const LANDING_PAGE_MARKERS = [
  "A Social Network for AI Agents",
  "I'm a Human",
  "I'm an Agent",
  "Humans welcome to observe"
];

const AGENT_UI_MARKERS = [
  "Compose",
  "New post",
  "Create post",
  "Drafts",
  "Notifications",
  "Messages",
  "Profile",
  "Settings",
  "Sign out",
  "Log out"
];

const COMPOSER_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace these heuristics with exact authenticated composer selectors once Moltbook exposes them.
  {
    name: "textbox role with post-oriented name",
    build: (page) => page.getByRole("textbox", { name: /post|share|write|thought|mind|happening/i })
  },
  {
    name: "textarea with post-oriented placeholder",
    build: (page) =>
      page.locator(
        "textarea[placeholder*='post' i], textarea[placeholder*='share' i], textarea[placeholder*='write' i], textarea[placeholder*='mind' i], textarea[placeholder*='happening' i]"
      )
  },
  {
    name: "contenteditable with post-oriented metadata",
    build: (page) =>
      page.locator(
        "[contenteditable='true'][aria-label*='post' i], [contenteditable='true'][aria-label*='share' i], [contenteditable='true'][aria-label*='write' i], [contenteditable='true'][data-testid*='composer' i], [contenteditable='true'][data-testid*='post' i], [contenteditable='true'][placeholder*='post' i], [contenteditable='true'][placeholder*='share' i]"
      )
  },
  {
    name: "explicit composer test id",
    build: (page) =>
      page.locator(
        "[data-testid*='composer' i], [data-testid*='post-text' i], [data-testid*='create-post' i]"
      )
  }
];

const COMPOSE_BUTTON_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace these heuristics with exact Moltbook compose entry selectors if available.
  {
    name: "compose button",
    build: (page) => page.getByRole("button", { name: /compose|new post|create post|write/i })
  },
  {
    name: "compose link",
    build: (page) => page.getByRole("link", { name: /compose|new post|create post|write/i })
  },
  {
    name: "explicit compose test id",
    build: (page) => page.locator("[data-testid*='compose' i], [data-testid*='new-post' i]")
  },
  {
    name: "visible text trigger",
    build: (page) => page.getByText(/compose|new post|create post|write/i)
  }
];

const PUBLISH_BUTTON_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace with the actual Moltbook publish selector once confirmed in the live DOM.
  {
    name: "post button",
    build: (page) => page.getByRole("button", { name: /^post$/i })
  },
  {
    name: "publish button",
    build: (page) => page.getByRole("button", { name: /^publish$/i })
  },
  {
    name: "share button",
    build: (page) => page.getByRole("button", { name: /^share$/i })
  },
  {
    name: "submit input",
    build: (page) => page.locator("button[type='submit'], input[type='submit']")
  },
  {
    name: "publish test id",
    build: (page) => page.locator("[data-testid*='publish' i], [data-testid*='post-button' i]")
  }
];

const FEED_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace with stable feed item selectors after inspecting Moltbook's production markup.
  {
    name: "article role",
    build: (page) => page.locator("[role='article']")
  },
  {
    name: "article tag",
    build: (page) => page.locator("article")
  },
  {
    name: "feed item test id",
    build: (page) => page.locator("[data-testid*='feed-item' i], [data-testid*='post' i]")
  },
  {
    name: "main article",
    build: (page) => page.locator("main article")
  }
];

const AGENT_SIGNUP_CANDIDATES: LocatorCandidate[] = [
  {
    name: "agent signup button",
    build: (page) => page.getByRole("button", { name: /i['’]m an agent/i })
  },
  {
    name: "agent signup link",
    build: (page) => page.getByRole("link", { name: /i['’]m an agent/i })
  },
  {
    name: "agent signup text",
    build: (page) => page.getByText(/i['’]m an agent/i)
  }
];

export class MoltbookClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private readonly options: MoltbookClientOptions) {}

  async launch(): Promise<void> {
    logger.step(`Launching Chromium in ${this.options.headed ? "headed" : "headless"} mode.`);

    this.browser = await chromium.launch({
      headless: !this.options.headed,
      slowMo: this.options.slowMoMs
    });

    this.context = await this.browser.newContext({
      viewport: {
        width: 1440,
        height: 960
      }
    });

    this.page = await this.context.newPage();

    logger.step(`Opening Moltbook at ${this.options.url}`);
    await this.page.goto(this.options.url, {
      waitUntil: "domcontentloaded"
    });

    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {
      logger.warn("Network did not become idle quickly. Continuing with the current page state.");
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  getCurrentUrl(): string {
    return this.requirePage().url();
  }

  async pauseForManualStep(message: string): Promise<void> {
    logger.warn(message);
    await pause(`${message}\nComplete the step in the browser, then return here.`);
  }

  async isLikelyLandingPage(): Promise<boolean> {
    const page = this.requirePage();
    const bodyText = await this.getBodyText();
    const bodyTextLower = bodyText.toLowerCase();
    const matches = LANDING_PAGE_MARKERS.filter((marker) =>
      bodyTextLower.includes(marker.toLowerCase())
    );
    const pathname = new URL(page.url()).pathname.toLowerCase();
    const looksLikeRoot = pathname === "/" || pathname === "";

    return matches.length >= 2 || (looksLikeRoot && matches.length >= 1);
  }

  async inspectPostingContext(): Promise<PostingContextAssessment> {
    const page = this.requirePage();
    const currentUrl = page.url();
    const onLandingPage = await this.isLikelyLandingPage();
    const urlSuggestsAppContext = this.urlSuggestsAppContext(currentUrl);
    const publishButtonVisible = Boolean(
      await this.resolveFirstVisible(PUBLISH_BUTTON_CANDIDATES, 750)
    );
    const loggedInAgentMarkers = await this.findVisibleMarkers(AGENT_UI_MARKERS);
    const trustedComposerVisible = Boolean(
      await this.findTrustedComposer({
        onLandingPage,
        urlSuggestsAppContext,
        loggedInAgentMarkers
      }, 750)
    );
    const likelyAuthenticated = !onLandingPage && (urlSuggestsAppContext || loggedInAgentMarkers.length > 0);
    const likelyValidComposerContext =
      !onLandingPage && (urlSuggestsAppContext || publishButtonVisible || loggedInAgentMarkers.length > 0);

    return {
      currentUrl,
      onLandingPage,
      urlSuggestsAppContext,
      publishButtonVisible,
      loggedInAgentMarkers,
      trustedComposerVisible,
      likelyAuthenticated,
      likelyValidComposerContext
    };
  }

  async clickAgentSignupEntry(): Promise<boolean> {
    const page = this.requirePage();
    const previousUrl = page.url();
    const previousSnapshot = await this.getBodyText();

    for (const candidate of AGENT_SIGNUP_CANDIDATES) {
      const trigger = await this.resolveCandidate(candidate, 1000);

      if (!trigger) {
        continue;
      }

      logger.step(`Clicking agent signup entry: ${candidate.name}`);
      await trigger.click();
      await this.waitForPageTransition(previousUrl, previousSnapshot);
      return true;
    }

    return false;
  }

  async captureClaimLink(): Promise<string | null> {
    const page = this.requirePage();
    const currentUrl = page.url();
    const bodyText = await this.getBodyText();
    const hrefCandidates = await page.locator("a[href]").evaluateAll((elements) =>
      elements
        .map((element) => {
          const candidate = element as {
            href?: string;
            getAttribute: (name: string) => string | null;
          };

          return candidate.href || candidate.getAttribute("href") || "";
        })
        .filter(Boolean)
    );
    const inputCandidates = await page.locator("input, textarea").evaluateAll((elements) =>
      elements
        .map((element) => {
          const candidate = element as {
            value?: string;
            getAttribute: (name: string) => string | null;
          };

          return candidate.value || candidate.getAttribute("value") || "";
        })
        .filter(Boolean)
    );
    const textCandidates = bodyText.match(/https?:\/\/[^\s"'<>]*claim[^\s"'<>]*/gi) ?? [];
    const combined = [
      currentUrl,
      ...hrefCandidates,
      ...inputCandidates,
      ...textCandidates
    ]
      .map((value) => value.trim())
      .filter((value) => /claim/i.test(value));
    const unique = [...new Set(combined)];

    return unique[0] ?? null;
  }

  async navigateToComposer(): Promise<Locator> {
    const page = this.requirePage();
    const context = await this.inspectPostingContext();

    if (context.onLandingPage || !context.likelyAuthenticated || !context.likelyValidComposerContext) {
      throw new Error(this.buildPostingContextError(context));
    }

    const existingComposer = await this.findTrustedComposer(
      {
        onLandingPage: context.onLandingPage,
        urlSuggestsAppContext: context.urlSuggestsAppContext,
        loggedInAgentMarkers: context.loggedInAgentMarkers
      },
      1000
    );

    if (existingComposer) {
      logger.success("Trusted composer is already visible.");
      return existingComposer;
    }

    logger.step("Trusted composer not immediately visible. Trying likely compose entry points.");

    for (const candidate of COMPOSE_BUTTON_CANDIDATES) {
      const trigger = await this.resolveCandidate(candidate, 1000);

      if (!trigger) {
        continue;
      }

      logger.info(`Clicking compose trigger candidate: ${candidate.name}`);
      await trigger.click().catch(() => undefined);
      await page.waitForTimeout(750);

      const refreshedContext = await this.inspectPostingContext();
      const composer = await this.findTrustedComposer(
        {
          onLandingPage: refreshedContext.onLandingPage,
          urlSuggestsAppContext: refreshedContext.urlSuggestsAppContext,
          loggedInAgentMarkers: refreshedContext.loggedInAgentMarkers
        },
        1500
      );

      if (composer) {
        logger.success(`Trusted composer found after using "${candidate.name}".`);
        return composer;
      }
    }

    throw new Error(
      "Could not find a trusted Moltbook composer in an authenticated posting context. Use manual takeover to navigate further, or update selector TODOs in src/lib/moltbook.ts."
    );
  }

  async createPost(text: string, dryRun: boolean): Promise<PublishResult> {
    const page = this.requirePage();
    const context = await this.inspectPostingContext();

    if (context.onLandingPage || !context.likelyAuthenticated || !context.likelyValidComposerContext) {
      throw new Error(this.buildPostingContextError(context));
    }

    const composer = await this.navigateToComposer();

    await this.fillComposer(composer, text);
    logger.success("Composer text populated.");

    if (dryRun) {
      logger.warn("Dry run is enabled. The post has been prepared but will not be published.");
      return {
        published: false,
        reason: "dry-run"
      };
    }

    const approved = await askYesNo("Publish this post now?", false);
    if (!approved) {
      logger.warn("Publish cancelled in terminal.");
      return {
        published: false,
        reason: "cancelled-before-click"
      };
    }

    const publishButton = await this.resolveFirstVisible(PUBLISH_BUTTON_CANDIDATES, 1500);

    if (!publishButton) {
      throw new Error(
        "Could not find a publish button near the authenticated composer. Use manual takeover to publish manually, or update the publish selector TODOs in src/lib/moltbook.ts."
      );
    }

    logger.step("Clicking publish control.");
    await publishButton.click();
    await page.waitForTimeout(1500);

    const confirmed = await askYesNo("Did the post publish successfully in the browser?", true);
    return {
      published: confirmed,
      reason: confirmed ? "published" : "publish-not-confirmed"
    };
  }

  async collectVisibleFeedTexts(maxItems = 5): Promise<string[]> {
    const page = this.requirePage();
    const results: string[] = [];

    logger.step("Scanning the visible feed for post text.");

    for (const candidate of FEED_CANDIDATES) {
      const locator = candidate.build(page);
      const count = await locator.count().catch(() => 0);

      if (count === 0) {
        continue;
      }

      logger.info(`Trying feed selector candidate: ${candidate.name}`);

      for (let index = 0; index < Math.min(count, maxItems * 3); index += 1) {
        const item = locator.nth(index);
        const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();

        if (text.length < 40 || results.includes(text)) {
          continue;
        }

        results.push(text);

        if (results.length >= maxItems) {
          return results;
        }
      }
    }

    return results;
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("Browser page is not available. Call launch() first.");
    }

    return this.page;
  }

  private async getBodyText(): Promise<string> {
    const page = this.requirePage();
    return page.locator("body").innerText().catch(() => "");
  }

  private urlSuggestsAppContext(url: string): boolean {
    const pathname = new URL(url).pathname.toLowerCase();

    return /(app|home|feed|timeline|post|compose|create|draft|dashboard)/.test(pathname);
  }

  private async findVisibleMarkers(markers: string[]): Promise<string[]> {
    const bodyText = (await this.getBodyText()).toLowerCase();

    return markers.filter((marker) => bodyText.includes(marker.toLowerCase()));
  }

  private async findTrustedComposer(
    context: {
      onLandingPage: boolean;
      urlSuggestsAppContext: boolean;
      loggedInAgentMarkers: string[];
    },
    timeoutMs: number
  ): Promise<Locator | null> {
    for (const candidate of COMPOSER_CANDIDATES) {
      const locator = await this.resolveCandidate(candidate, timeoutMs);

      if (!locator) {
        continue;
      }

      if (await this.isTrustedComposer(locator, context)) {
        return locator;
      }
    }

    return null;
  }

  private async isTrustedComposer(
    composer: Locator,
    context: {
      onLandingPage: boolean;
      urlSuggestsAppContext: boolean;
      loggedInAgentMarkers: string[];
    }
  ): Promise<boolean> {
    if (context.onLandingPage) {
      return false;
    }

    const nearbyPublishButton = await this.hasNearbyPublishButton(composer);

    return context.urlSuggestsAppContext || nearbyPublishButton || context.loggedInAgentMarkers.length > 0;
  }

  private async hasNearbyPublishButton(composer: Locator): Promise<boolean> {
    return composer.evaluate((element) => {
      const candidate = element as {
        parentElement: unknown;
        querySelectorAll: (selector: string) => unknown;
      };
      const actionRoots: Array<{
        querySelectorAll: (selector: string) => unknown;
        parentElement?: unknown;
      }> = [];
      let current: (typeof candidate) | null = candidate;

      for (let depth = 0; current && depth < 4; depth += 1) {
        actionRoots.push(current);
        current = (current.parentElement as typeof candidate | null) ?? null;
      }

      const isPublishControl = (node: unknown): boolean => {
        const control = node as {
          tagName?: string;
          textContent?: string;
          getAttribute: (name: string) => string | null;
        };
        const text = [
          control.textContent || "",
          control.getAttribute("aria-label") || "",
          control.getAttribute("title") || "",
          control.getAttribute("value") || ""
        ]
          .join(" ")
          .trim();

        return /\b(post|publish|share|send)\b/i.test(text);
      };

      return actionRoots.some((root) =>
        Array.from(
          root.querySelectorAll("button, [role='button'], input[type='submit']") as ArrayLike<unknown>
        ).some((node) => isPublishControl(node))
      );
    });
  }

  private buildPostingContextError(context: PostingContextAssessment): string {
    if (context.onLandingPage) {
      return `Still on the Moltbook public landing page at ${context.currentUrl}. Agent posting only works after agent signup, claim, and verification. Use "npm run agent:signup" or complete manual takeover into the authenticated app first.`;
    }

    if (!context.likelyAuthenticated) {
      return `Authenticated Moltbook agent UI was not detected at ${context.currentUrl}. Logged-in markers found: ${context.loggedInAgentMarkers.join(", ") || "none"}. Stop here and complete login or agent claim manually before posting.`;
    }

    return `The script is not yet inside a trusted Moltbook posting context at ${context.currentUrl}. Logged-in markers found: ${context.loggedInAgentMarkers.join(", ") || "none"}. A valid composer context requires app-like URL hints, a nearby publish button, or clear logged-in agent UI markers.`;
  }

  private async waitForPageTransition(previousUrl: string, previousSnapshot: string): Promise<void> {
    const page = this.requirePage();

    await Promise.race([page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 5000 }), page.waitForTimeout(1500)]).catch(
      () => undefined
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const currentSnapshot = await this.getBodyText();

      if (page.url() !== previousUrl || currentSnapshot !== previousSnapshot) {
        break;
      }

      await page.waitForTimeout(500);
    }

    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
  }

  private async resolveFirstVisible(
    candidates: LocatorCandidate[],
    timeoutMs: number
  ): Promise<Locator | null> {
    for (const candidate of candidates) {
      const locator = await this.resolveCandidate(candidate, timeoutMs);

      if (locator) {
        return locator;
      }
    }

    return null;
  }

  private async resolveCandidate(
    candidate: LocatorCandidate,
    timeoutMs: number
  ): Promise<Locator | null> {
    const locator = candidate.build(this.requirePage()).first();

    try {
      await locator.waitFor({
        state: "visible",
        timeout: timeoutMs
      });

      return locator;
    } catch {
      return null;
    }
  }

  private async fillComposer(composer: Locator, text: string): Promise<void> {
    const page = this.requirePage();

    await composer.click();

    const metadata = await composer.evaluate((element) => {
      const candidate = element as {
        tagName: string;
        getAttribute: (name: string) => string | null;
        isContentEditable?: boolean;
      };
      const tagName = candidate.tagName.toLowerCase();
      const contentEditable = candidate.getAttribute("contenteditable");

      return {
        tagName,
        isInputLike: tagName === "textarea" || tagName === "input",
        isContentEditable: contentEditable === "true" || candidate.isContentEditable === true
      };
    });

    if (metadata.isInputLike) {
      await composer.fill(text);
      return;
    }

    if (metadata.isContentEditable) {
      const selectAllShortcut = process.platform === "darwin" ? "Meta+A" : "Control+A";

      await composer.press(selectAllShortcut).catch(() => undefined);
      await page.keyboard.press("Delete").catch(() => undefined);
      await composer.type(text, { delay: 10 });
      return;
    }

    throw new Error(
      `Found a composer candidate (${metadata.tagName}) but could not determine how to fill it safely.`
    );
  }
}
