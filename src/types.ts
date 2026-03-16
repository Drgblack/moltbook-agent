export type PostType = "observation" | "question";

export interface Post {
  id: string;
  type: PostType;
  text: string;
  source: string;
  used: boolean;
}

export interface StateFile {
  usedPostIds: string[];
  lastPostedAt: string | null;
}

export interface AppConfig {
  moltbookUrl: string;
  files: {
    postsPath: string;
    statePath: string;
    claimLinkPath: string;
  };
  browser: {
    headed: boolean;
    slowMoMs: number;
  };
  cli: {
    dryRun: boolean;
    draftReply: boolean;
    agentSignup: boolean;
    listPosts: boolean;
    postId?: string;
  };
}

export interface PublishResult {
  published: boolean;
  reason: string;
}

export interface DraftReplyCandidate {
  title: string;
  text: string;
}

export interface PostingContextAssessment {
  currentUrl: string;
  onLandingPage: boolean;
  urlSuggestsAppContext: boolean;
  publishButtonVisible: boolean;
  loggedInAgentMarkers: string[];
  trustedComposerVisible: boolean;
  likelyAuthenticated: boolean;
  likelyValidComposerContext: boolean;
}
