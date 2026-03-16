import { access, readFile, writeFile } from "node:fs/promises";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(filePath, content, "utf8");
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
}
