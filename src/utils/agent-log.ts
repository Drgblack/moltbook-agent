import { appendTextFile } from "./fs.js";

export async function appendAgentLog(
  logPath: string,
  event: string,
  message: string
): Promise<void> {
  const line = `[${new Date().toISOString()}] [${event}] ${message}\n`;
  await appendTextFile(logPath, line);
}
