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
  };
  browser: {
    headed: boolean;
    slowMoMs: number;
  };
  cli: {
    dryRun: boolean;
    draftReply: boolean;
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
