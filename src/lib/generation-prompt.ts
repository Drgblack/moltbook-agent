import type { FeedPostSummary, HomeSummary, Post } from "../types.js";

interface PromptContext {
  agentName: string;
  agentDescription: string;
  feedPosts: FeedPostSummary[];
  homeSummary: HomeSummary | null;
  approvedPosts: Post[];
}

export function buildFeedContextFile(context: PromptContext): Record<string, unknown> {
  return {
    generated_at: new Date().toISOString(),
    agent_name: context.agentName,
    agent_description: context.agentDescription,
    home_summary: context.homeSummary
      ? {
          account_name: context.homeSummary.accountName,
          karma: context.homeSummary.karma,
          unread_notifications: context.homeSummary.unreadNotifications,
          recent_activity: context.homeSummary.recentActivity,
          what_to_do_next: context.homeSummary.whatToDoNext
        }
      : null,
    recent_feed: context.feedPosts.map((post) => ({
      id: post.id,
      title: post.title,
      author: post.authorName,
      submolt: post.submoltName,
      created_at: post.createdAt,
      content: summariseText(post.content, 280)
    })),
    approved_post_examples: selectApprovedExamples(context.approvedPosts).map((post) => ({
      id: post.id,
      type: post.type,
      text: post.text
    }))
  };
}

export function buildCandidateGenerationPrompt(context: PromptContext): string {
  const approvedExamples = selectApprovedExamples(context.approvedPosts)
    .map((post, index) => `${index + 1}. (${post.type}) ${post.text}`)
    .join("\n");
  const feedSummaries = context.feedPosts
    .slice(0, 20)
    .map(
      (post, index) =>
        `${index + 1}. ${post.title || "[untitled]"} | ${post.authorName || "unknown"} | ${summariseText(post.content, 220)}`
    )
    .join("\n");
  const homeSummary = context.homeSummary
    ? [
        `Account name: ${context.homeSummary.accountName || "unknown"}`,
        `Karma: ${context.homeSummary.karma ?? "unknown"}`,
        `Unread notifications: ${context.homeSummary.unreadNotifications ?? "unknown"}`,
        `Recent activity: ${context.homeSummary.recentActivity.join(" | ") || "none returned"}`,
        `What to do next: ${context.homeSummary.whatToDoNext.join(" | ") || "none returned"}`
      ].join("\n")
    : "Home summary unavailable.";

  return `You are helping prepare candidate Moltbook posts for ${context.agentName}.

Agent description:
${context.agentDescription}

Voice requirements:
- thoughtful
- calm
- analytical
- slightly curious
- not promotional
- UK English

Topical focus:
- tone safety
- escalation risk
- teacher-parent communication
- human-AI collaboration
- psychologically aware writing
- trust in AI writing systems

Important constraints:
- Generate 10 to 20 standalone Moltbook post candidates.
- Do not include headings, explanations, labels, numbering, or commentary outside the JSON output.
- Do not write ads, calls to action, hashtags, or bios.
- Do not repeat exact phrases from the examples below.
- Keep each candidate concise and self-contained.
- Mix observations and discussion questions.
- Questions should feel reflective rather than engagement bait.
- Do not mention being asked to generate content.

Recent Moltbook feed context:
${feedSummaries || "No feed posts available."}

Recent home/dashboard context:
${homeSummary}

Examples of already-approved Zaza posts:
${approvedExamples || "No approved examples available."}

Return JSON only in this exact shape:
[
  {
    "type": "observation",
    "text": "Candidate post text here"
  },
  {
    "type": "question",
    "text": "Candidate question here?"
  }
]

Do not include any additional keys.`;
}

function selectApprovedExamples(posts: Post[]): Post[] {
  return posts
    .filter((post) => post.text.trim().length >= 60)
    .slice(0, 6);
}

function summariseText(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength - 3).trim()}...`;
}
