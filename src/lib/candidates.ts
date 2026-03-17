import type { CandidatePost, Post, PostType } from "../types.js";
import { fileExists, readJsonFile, writeJsonFile } from "../utils/fs.js";

interface CandidateSeed {
  type?: PostType;
  text: string;
  source?: string;
}

interface ImportGeneratedResult {
  candidates: CandidatePost[];
  addedCount: number;
  duplicateCount: number;
}

const MIN_CANDIDATE_LENGTH = 40;

export async function loadCandidates(filePath: string): Promise<CandidatePost[]> {
  if (!(await fileExists(filePath))) {
    return [];
  }

  return readJsonFile<CandidatePost[]>(filePath);
}

export async function saveCandidates(filePath: string, candidates: CandidatePost[]): Promise<void> {
  await writeJsonFile(filePath, candidates);
}

export function getPendingCandidates(candidates: CandidatePost[]): CandidatePost[] {
  return candidates.filter((candidate) => !candidate.approved && candidate.rejected !== true);
}

export function inferPostType(text: string): PostType {
  return text.trim().endsWith("?") ? "question" : "observation";
}

export function normaliseCandidateText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseGeneratedCandidates(rawContent: string): CandidateSeed[] {
  const jsonParsed = parseGeneratedCandidatesAsJson(rawContent);

  if (jsonParsed.length > 0) {
    return jsonParsed;
  }

  return parseGeneratedCandidatesAsText(rawContent);
}

export function importGeneratedCandidates(
  existingCandidates: CandidatePost[],
  existingPosts: Post[],
  seeds: CandidateSeed[],
  source: string
): ImportGeneratedResult {
  const merged = [...existingCandidates];
  const referenceTexts = [
    ...existingPosts.map((post) => post.text),
    ...existingCandidates.map((candidate) => candidate.text)
  ];
  const nextNumber = getNextCandidateNumber(existingCandidates);
  let addedCount = 0;
  let duplicateCount = 0;

  for (const seed of seeds) {
    const text = normaliseCandidateText(seed.text);

    if (text.length < MIN_CANDIDATE_LENGTH) {
      duplicateCount += 1;
      continue;
    }

    if (isDuplicateText(text, referenceTexts)) {
      duplicateCount += 1;
      continue;
    }

    const candidate: CandidatePost = {
      id: `candidate-${String(nextNumber + addedCount).padStart(3, "0")}`,
      type: seed.type ?? inferPostType(text),
      text,
      source: seed.source ?? source,
      created_at: new Date().toISOString(),
      approved: false
    };

    merged.push(candidate);
    referenceTexts.push(candidate.text);
    addedCount += 1;
  }

  return {
    candidates: merged,
    addedCount,
    duplicateCount
  };
}

export function isDuplicateText(text: string, referenceTexts: string[]): boolean {
  return referenceTexts.some((reference) => areTextsNearDuplicate(text, reference));
}

export function buildApprovedPostFromCandidate(candidate: CandidatePost, existingPosts: Post[]): Post {
  return {
    id: `generated-${String(getNextGeneratedPostNumber(existingPosts)).padStart(3, "0")}`,
    type: candidate.type,
    text: normaliseCandidateText(candidate.text),
    source: candidate.source,
    used: false
  };
}

function getNextCandidateNumber(candidates: CandidatePost[]): number {
  const maxNumber = candidates.reduce((max, candidate) => {
    const match = candidate.id.match(/^candidate-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return maxNumber + 1;
}

function getNextGeneratedPostNumber(posts: Post[]): number {
  const maxNumber = posts.reduce((max, post) => {
    const match = post.id.match(/^generated-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return maxNumber + 1;
}

function parseGeneratedCandidatesAsJson(rawContent: string): CandidateSeed[] {
  try {
    const parsed = JSON.parse(rawContent) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => normaliseSeed(item));
    }

    if (isRecord(parsed) && Array.isArray(parsed.candidates)) {
      return parsed.candidates.flatMap((item) => normaliseSeed(item));
    }

    return [];
  } catch {
    return [];
  }
}

function parseGeneratedCandidatesAsText(rawContent: string): CandidateSeed[] {
  return rawContent
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => stripListPrefix(block))
    .map((block) => normaliseCandidateText(block))
    .filter((block) => block.length >= MIN_CANDIDATE_LENGTH)
    .map((text) => ({
      type: inferPostType(text),
      text
    }));
}

function normaliseSeed(value: unknown): CandidateSeed[] {
  if (typeof value === "string") {
    const text = normaliseCandidateText(stripListPrefix(value));
    return text ? [{ type: inferPostType(text), text }] : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  const textValue = typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
  const text = normaliseCandidateText(stripListPrefix(textValue));

  if (!text) {
    return [];
  }

  const type = value.type === "question" || value.type === "observation" ? value.type : inferPostType(text);
  const source = typeof value.source === "string" && value.source.trim() ? value.source.trim() : undefined;

  return [{ type, text, source }];
}

function stripListPrefix(value: string): string {
  return value
    .replace(/^\s*(candidate|post)\s*\d+\s*[:.-]\s*/i, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+[\).:-]\s+/, "")
    .trim();
}

function areTextsNearDuplicate(left: string, right: string): boolean {
  const leftKey = normaliseForComparison(left);
  const rightKey = normaliseForComparison(right);

  if (!leftKey || !rightKey) {
    return false;
  }

  if (leftKey === rightKey) {
    return true;
  }

  const shorterLength = Math.min(leftKey.length, rightKey.length);
  const longerLength = Math.max(leftKey.length, rightKey.length);

  if ((leftKey.includes(rightKey) || rightKey.includes(leftKey)) && shorterLength / longerLength >= 0.72) {
    return true;
  }

  const leftTokens = tokeniseForComparison(leftKey);
  const rightTokens = tokeniseForComparison(rightKey);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const rightTokenSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter((token) => rightTokenSet.has(token)).length;
  const overlap = sharedCount / Math.min(leftTokens.length, rightTokens.length);

  return overlap >= 0.85;
}

function normaliseForComparison(text: string): string {
  return normaliseCandidateText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokeniseForComparison(text: string): string[] {
  return [...new Set(text.split(" ").filter((token) => token.length > 2))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
