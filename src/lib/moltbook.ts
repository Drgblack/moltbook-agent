import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import type { PublishResult } from "../types.js";
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

const COMPOSER_CANDIDATES: LocatorCandidate[] = [
  // TODO: tighten these selectors once Moltbook exposes stable composer attributes.
  {
    name: "textbox role with post-like accessible name",
    build: (page) => page.getByRole("textbox", { name: /post|write|what.?s happening|share/i }).first()
  },
  {
    name: "generic textbox role",
    build: (page) => page.getByRole("textbox").first()
  },
  {
    name: "contenteditable composer",
    build: (page) => page.locator("[contenteditable='true']").first()
  },
  {
    name: "textarea composer",
    build: (page) => page.locator("textarea").first()
  },
  {
    name: "composer test id",
    build: (page) => page.locator("[data-testid*='composer'], [data-testid*='post-text']").first()
  }
];

const COMPOSE_BUTTON_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace these heuristics with exact Moltbook compose entry selectors if available.
  {
    name: "compose button",
    build: (page) => page.getByRole("button", { name: /compose|new post|create post|write/i }).first()
  },
  {
    name: "compose link",
    build: (page) => page.getByRole("link", { name: /compose|new post|create post|write/i }).first()
  },
  {
    name: "explicit compose test id",
    build: (page) => page.locator("[data-testid*='compose'], [data-testid*='new-post']").first()
  },
  {
    name: "visible text trigger",
    build: (page) => page.getByText(/compose|new post|create post|write/i).first()
  }
];

const PUBLISH_BUTTON_CANDIDATES: LocatorCandidate[] = [
  // TODO: replace with the actual Moltbook submit selector once confirmed in the live DOM.
  {
    name: "post button",
    build: (page) => page.getByRole("button", { name: /post|publish|send|share/i }).first()
  },
  {
    name: "submit input",
    build: (page) => page.locator("button[type='submit'], input[type='submit']").first()
  },
  {
    name: "publish test id",
    build: (page) => page.locator("[data-testid*='publish'], [data-testid*='post-button']").first()
  },
  {
    name: "visible text publish control",
    build: (page) => page.getByText(/post|publish|send|share/i).first()
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
    build: (page) => page.locator("[data-testid*='feed-item'], [data-testid*='post']")
  },
  {
    name: "main article",
    build: (page) => page.locator("main article")
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

  async pauseForManualStep(message: string): Promise<void> {
    logger.warn(message);
    await pause(`${message}\nComplete the step in the browser, then return here.`);
  }

  async navigateToComposer(): Promise<Locator> {
    const page = this.requirePage();
    const existingComposer = await this.resolveFirstVisible(COMPOSER_CANDIDATES, 1000);

    if (existingComposer) {
      logger.success("Composer is already visible.");
      return existingComposer;
    }

    logger.step("Composer not immediately visible. Trying likely compose entry points.");

    for (const candidate of COMPOSE_BUTTON_CANDIDATES) {
      const trigger = await this.resolveCandidate(candidate, 1000);

      if (!trigger) {
        continue;
      }

      logger.info(`Clicking compose trigger candidate: ${candidate.name}`);
      await trigger.click().catch(() => undefined);
      await page.waitForTimeout(750);

      const composer = await this.resolveFirstVisible(COMPOSER_CANDIDATES, 1500);
      if (composer) {
        logger.success(`Composer found after using "${candidate.name}".`);
        return composer;
      }
    }

    throw new Error(
      "Could not find a Moltbook composer. Use manual takeover to navigate to the posting UI, then rerun or update selector TODOs in src/lib/moltbook.ts."
    );
  }

  async createPost(text: string, dryRun: boolean): Promise<PublishResult> {
    const page = this.requirePage();
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
        "Could not find a publish button. Use manual takeover to publish manually, or update the publish selector TODOs in src/lib/moltbook.ts."
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
