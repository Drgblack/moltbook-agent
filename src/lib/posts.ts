import type { DraftReplyCandidate, Post, StateFile } from "../types.js";
import { fileExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

function assertPost(value: unknown, index: number): Post {
  const candidate = value as Partial<Post>;

  if (
    typeof candidate?.id !== "string" ||
    typeof candidate?.type !== "string" ||
    typeof candidate?.text !== "string" ||
    typeof candidate?.source !== "string"
  ) {
    throw new Error(`Invalid post at index ${index}.`);
  }

  return {
    id: candidate.id,
    type: candidate.type as Post["type"],
    text: candidate.text,
    source: candidate.source,
    used: Boolean(candidate.used)
  };
}

function normaliseState(value: unknown): StateFile {
  const candidate = value as Partial<StateFile>;

  return {
    usedPostIds: Array.isArray(candidate?.usedPostIds)
      ? candidate.usedPostIds.filter((item): item is string => typeof item === "string")
      : [],
    lastPostedAt: typeof candidate?.lastPostedAt === "string" ? candidate.lastPostedAt : null
  };
}

export async function loadPosts(postsPath: string): Promise<Post[]> {
  if (!(await fileExists(postsPath))) {
    throw new Error(`posts.json was not found at ${postsPath}`);
  }

  const data = await readJsonFile<unknown>(postsPath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read posts.json at ${postsPath}: ${message}`);
  });

  if (!Array.isArray(data)) {
    throw new Error("posts.json must contain an array.");
  }

  // Validate every item up front so selector or browser work never starts with bad content.
  return data.map((item, index) => assertPost(item, index));
}

export async function loadState(statePath: string): Promise<StateFile> {
  if (!(await fileExists(statePath))) {
    throw new Error(`state.json was not found at ${statePath}`);
  }

  const data = await readJsonFile<unknown>(statePath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read state.json at ${statePath}: ${message}`);
  });

  return normaliseState(data);
}

export function getUnusedPosts(posts: Post[], state: StateFile): Post[] {
  const usedIds = new Set(state.usedPostIds);
  return posts.filter((post) => !usedIds.has(post.id) && !post.used);
}

export function selectPost(posts: Post[], state: StateFile, requestedId?: string): Post {
  const usedIds = new Set(state.usedPostIds);

  if (requestedId) {
    const requested = posts.find((post) => post.id === requestedId);

    if (!requested) {
      throw new Error(`Post id "${requestedId}" was not found in posts.json.`);
    }

    if (usedIds.has(requested.id) || requested.used) {
      throw new Error(`Post id "${requestedId}" is already marked as used.`);
    }

    return requested;
  }

  const nextPost = posts.find((post) => !usedIds.has(post.id) && !post.used);

  if (!nextPost) {
    throw new Error("No unused posts remain in posts.json.");
  }

  return nextPost;
}

export function formatPost(post: Post): string {
  return [
    `ID:     ${post.id}`,
    `Type:   ${post.type}`,
    `Source: ${post.source}`,
    "",
    post.text
  ].join("\n");
}

export async function recordPublishedPost(
  postsPath: string,
  statePath: string,
  postId: string
): Promise<void> {
  // Update both files together so the content list and the publish ledger stay in sync.
  const [posts, state] = await Promise.all([loadPosts(postsPath), loadState(statePath)]);

  const nextState: StateFile = {
    usedPostIds: state.usedPostIds.includes(postId) ? state.usedPostIds : [...state.usedPostIds, postId],
    lastPostedAt: new Date().toISOString()
  };

  const nextPosts = posts.map((post) => {
    if (post.id !== postId) {
      return post;
    }

    return {
      ...post,
      used: true
    };
  });

  await Promise.all([writeJsonFile(postsPath, nextPosts), writeJsonFile(statePath, nextState)]);
}

function shrinkText(text: string, limit = 180): string {
  const singleLine = text.replace(/\s+/g, " ").trim();

  if (singleLine.length <= limit) {
    return singleLine;
  }

  return `${singleLine.slice(0, limit - 1)}...`;
}

function buildReplyFocus(sourceText: string): string {
  const text = sourceText.toLowerCase();

  if (/(teacher|parent|school|student|classroom|education)/.test(text)) {
    return "The difficult part in education communication is often preserving clarity without adding heat.";
  }

  if (/(trust|safe|safety|risk|escalat)/.test(text)) {
    return "I think the trust question usually turns on whether the system helps a person notice risk before they send.";
  }

  if (/(tone|language|wording|message)/.test(text)) {
    return "What interests me is whether the wording reduces ambiguity rather than simply sounding smoother.";
  }

  if (/(human|collaboration|review|handoff|workflow)/.test(text)) {
    return "The hand-off point feels central here: what stays automated, and what still needs deliberate human judgement?";
  }

  return "The useful test may be whether this improves judgement, not merely output speed.";
}

export function draftReplyCandidates(feedTexts: string[]): DraftReplyCandidate[] {
  const sourceText = feedTexts[0] || "A short Moltbook post about AI-assisted communication.";
  const excerpt = shrinkText(sourceText, 110);
  const focus = buildReplyFocus(sourceText);

  // These replies are deterministic on purpose: review-friendly, no external model dependency.
  return [
    {
      title: "Candidate 1",
      text: `${focus} ${excerpt ? `The post here seems to point in that direction.` : ""}`.trim()
    },
    {
      title: "Candidate 2",
      text: "Interesting angle. I suspect the harder problem is deciding when a draft needs a human pause, especially once tone or escalation risk enters the picture."
    },
    {
      title: "Candidate 3",
      text: "I am inclined to agree, though I would frame it as a review problem first and a generation problem second. The useful systems are the ones that make judgement easier."
    }
  ];
}
