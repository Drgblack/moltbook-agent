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
  api: {
    base: string;
    apiKey: string;
    agentName: string;
    agentDescription: string;
    submoltName: string;
  };
  files: {
    postsPath: string;
    statePath: string;
    claimLinkPath: string;
    credentialsPath: string;
  };
  browser: {
    headed: boolean;
    slowMoMs: number;
  };
  cli: {
    dryRun: boolean;
    draftReply: boolean;
    agentSignup: boolean;
    agentRegister: boolean;
    agentRegisterDebug: boolean;
    agentStatus: boolean;
    listPosts: boolean;
    postApi: boolean;
    feedApi: boolean;
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

export interface CredentialsFile {
  api_base: string;
  api_key: string;
  claim_url?: string;
  verification_code?: string;
  agent_name: string;
  agent_description: string;
  saved_at: string;
}

export interface AgentRegistrationResult {
  apiKey: string | null;
  claimUrl: string | null;
  verificationCode: string | null;
  raw: unknown;
}

export interface AgentStatusResult {
  status: string;
  raw: unknown;
}

export interface ApiPostAttempt {
  success: boolean;
  verificationRequired: boolean;
  challengeDetails: string | null;
  postId: string | null;
  raw: unknown;
}

export interface FeedPostSummary {
  id: string | null;
  title: string | null;
  content: string;
  submoltName: string | null;
  authorName: string | null;
  createdAt: string | null;
}
