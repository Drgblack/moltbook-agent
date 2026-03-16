export const OFFICIAL_MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface JsonRequestOptions {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export function assertOfficialMoltbookApiBase(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");

  if (normalized !== OFFICIAL_MOLTBOOK_API_BASE) {
    throw new Error(
      `Moltbook API calls are restricted to ${OFFICIAL_MOLTBOOK_API_BASE}. Refusing to use ${normalized}.`
    );
  }

  return normalized;
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: {
        Accept: "application/json",
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = text ? tryParseJson(text) : null;

    if (!response.ok) {
      throw new HttpError(
        `HTTP ${response.status} returned from ${options.url}`,
        response.status,
        parsed ?? text
      );
    }

    return (parsed as T) ?? ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
