import type {
  AgentRegistrationResult,
  AgentStatusResult,
  ApiPostAttempt,
  FeedPostSummary,
  HomeSummary
} from "../types.js";
import {
  HttpError,
  assertOfficialMoltbookApiBase,
  requestJson
} from "../utils/http.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findStringField(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const direct = getString(record[key]);

    if (direct) {
      return direct;
    }
  }

  return null;
}

function getNestedRecord(record: JsonRecord, key: string): JsonRecord {
  return isRecord(record[key]) ? record[key] : {};
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => getString(item))
      .filter((item): item is string => Boolean(item));
  }

  const single = getString(value);
  return single ? [single] : [];
}

function formatUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractChallengeDetails(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return typeof payload === "string" && /verification|challenge/i.test(payload) ? payload : null;
  }

  const challengeKeys = [
    "challenge",
    "verification",
    "verification_challenge",
    "verificationChallenge",
    "message",
    "error",
    "detail"
  ];
  const status = findStringField(payload, ["status", "state", "result"]);
  const challengeFlag =
    payload.verification_required === true ||
    payload.requires_verification === true ||
    Boolean(status && /verification|challenge|pending/i.test(status));

  if (!challengeFlag) {
    return null;
  }

  for (const key of challengeKeys) {
    if (key in payload) {
      const formatted = formatUnknown(payload[key]);

      if (formatted) {
        return formatted;
      }
    }
  }

  return status ? `Verification status: ${status}` : "Verification challenge required.";
}

function extractFeedItems(payload: unknown): FeedPostSummary[] {
  const candidateArray = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.posts)
      ? payload.posts
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : [];

  return candidateArray
    .filter((item): item is JsonRecord => isRecord(item))
    .map((item) => {
      const author = isRecord(item.author) ? item.author : {};

      return {
        id: findStringField(item, ["id", "post_id"]),
        title: findStringField(item, ["title"]),
        content:
          findStringField(item, ["content", "body", "text", "post_text"]) || "[no content returned]",
        submoltName: findStringField(item, ["submolt_name", "submolt"]),
        authorName: isRecord(author) ? findStringField(author, ["name", "username"]) : null,
        createdAt: findStringField(item, ["created_at", "published_at", "timestamp"])
      };
    });
}

export class MoltbookApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly apiKey = "") {
    this.baseUrl = assertOfficialMoltbookApiBase(baseUrl);
  }

  async registerAgent(name: string, description: string): Promise<AgentRegistrationResult> {
    const payload = await requestJson<unknown>({
      method: "POST",
      url: this.buildUrl("/agents/register"),
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        name,
        description
      }
    });

    const record = isRecord(payload) ? payload : {};
    const nestedAgent = getNestedRecord(record, "agent");

    return {
      apiKey:
        findStringField(record, ["api_key"]) ||
        findStringField(nestedAgent, ["api_key"]),
      claimUrl:
        findStringField(record, ["claim_url"]) ||
        findStringField(nestedAgent, ["claim_url"]),
      verificationCode:
        findStringField(record, ["verification_code"]) ||
        findStringField(nestedAgent, ["verification_code"]),
      raw: payload
    };
  }

  async getAgentStatus(): Promise<AgentStatusResult> {
    const payload = await requestJson<unknown>({
      method: "GET",
      url: this.buildUrl("/agents/status"),
      headers: this.buildAuthHeaders()
    });
    const record = isRecord(payload) ? payload : {};
    const nestedAgent = getNestedRecord(record, "agent");

    return {
      status:
        findStringField(record, ["status"]) ||
        findStringField(nestedAgent, ["status"]) ||
        "unknown",
      raw: payload
    };
  }

  async createPost(title: string, content: string, submoltName: string): Promise<ApiPostAttempt> {
    try {
      const payload = await requestJson<unknown>({
        method: "POST",
        url: this.buildUrl("/posts"),
        headers: {
          ...this.buildAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: {
          submolt_name: submoltName,
          title,
          content
        }
      });

      const record = isRecord(payload) ? payload : {};
      const nestedPost = getNestedRecord(record, "post");
      const challengeDetails = extractChallengeDetails(payload);

      return {
        success: challengeDetails === null,
        verificationRequired: challengeDetails !== null,
        challengeDetails,
        postId:
          findStringField(record, ["id", "post_id"]) ||
          findStringField(nestedPost, ["id", "post_id"]),
        raw: payload
      };
    } catch (error: unknown) {
      if (error instanceof HttpError) {
        const challengeDetails = extractChallengeDetails(error.body);

        if (challengeDetails) {
          return {
            success: false,
            verificationRequired: true,
            challengeDetails,
            postId: null,
            raw: error.body
          };
        }
      }

      throw error;
    }
  }

  async fetchFeed(limit = 10): Promise<FeedPostSummary[]> {
    const payload = await requestJson<unknown>({
      method: "GET",
      url: this.buildUrl(`/posts?sort=new&limit=${limit}`),
      headers: this.buildAuthHeaders()
    });

    return extractFeedItems(payload);
  }

  async fetchHome(): Promise<HomeSummary> {
    const payload = await requestJson<unknown>({
      method: "GET",
      url: this.buildUrl("/home"),
      headers: this.buildAuthHeaders()
    });
    const record = isRecord(payload) ? payload : {};
    const home = getNestedRecord(record, "home");
    const account = getNestedRecord(record, "account");
    const agent = getNestedRecord(record, "agent");
    const notifications = getNestedRecord(record, "notifications");

    return {
      accountName:
        findStringField(record, ["account_name", "name", "username"]) ||
        findStringField(account, ["name", "username"]) ||
        findStringField(agent, ["name", "username"]),
      karma:
        getNumber(record.karma) ??
        getNumber(home.karma) ??
        getNumber(account.karma) ??
        null,
      unreadNotifications:
        getNumber(record.unread_notifications) ??
        getNumber(notifications.unread_count) ??
        getNumber(home.unread_notifications) ??
        null,
      recentActivity:
        getStringArray(record.recent_activity).length > 0
          ? getStringArray(record.recent_activity)
          : getStringArray(home.recent_activity),
      whatToDoNext:
        getStringArray(record.what_to_do_next).length > 0
          ? getStringArray(record.what_to_do_next)
          : getStringArray(home.what_to_do_next),
      raw: payload
    };
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private buildAuthHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error(
        "MOLTBOOK_API_KEY is missing and no credentials.json api_key was available. Refusing to call the Moltbook API without credentials."
      );
    }

    return {
      Authorization: `Bearer ${this.apiKey}`
    };
  }
}
