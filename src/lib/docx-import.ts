import mammoth from "mammoth";

import type { Post, PostType } from "../types.js";

interface DocxImportResult {
  posts: Post[];
  rawBlockCount: number;
  uniqueBlockCount: number;
}

export async function importPostsFromDocx(docxPath: string): Promise<DocxImportResult> {
  const result = await mammoth.extractRawText({
    path: docxPath
  });
  const cleanedText = normaliseWhitespace(result.value);
  const rawBlocks = splitIntoBlocks(cleanedText);
  const uniqueBlocks = deduplicateBlocks(rawBlocks);

  const posts = uniqueBlocks.map((text, index) => ({
    id: `imported-${String(index + 1).padStart(3, "0")}`,
    type: (text.trim().endsWith("?") ? "question" : "observation") as PostType,
    text,
    source: "docx-import",
    used: false
  }));

  return {
    posts,
    rawBlockCount: rawBlocks.length,
    uniqueBlockCount: uniqueBlocks.length
  };
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoBlocks(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const blocks: string[] = [];

  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index];
    const next = paragraphs[index + 1];

    if (looksLikeHeading(current) && next) {
      blocks.push(`${current}\n\n${next}`.replace(/\s+/g, " ").trim());
      index += 1;
      continue;
    }

    const numberedSections = splitNumberedSections(current);

    if (numberedSections.length > 1) {
      blocks.push(...numberedSections);
      continue;
    }

    blocks.push(current);
  }

  return blocks.filter((block) => block.length >= 20);
}

function looksLikeHeading(text: string): boolean {
  return (
    text.length <= 80 &&
    !/[.!?]$/.test(text) &&
    (/^[A-Z0-9][A-Za-z0-9 ,:'"()/-]+$/.test(text) || /^\d+[\).:-]\s+/.test(text))
  );
}

function splitNumberedSections(text: string): string[] {
  const matches = text.match(/\d+[\).:-]\s+[^]+?(?=(?:\s+\d+[\).:-]\s+)|$)/g);

  if (!matches) {
    return [text];
  }

  return matches
    .map((section) => section.replace(/\s+/g, " ").trim())
    .filter((section) => section.length >= 20);
}

function deduplicateBlocks(blocks: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const block of blocks) {
    const key = block.toLowerCase().replace(/\s+/g, " ").trim();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(block);
  }

  return unique;
}
