import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const readline = createInterface({
  input,
  output
});

export async function ask(question: string): Promise<string> {
  try {
    return await readline.question(question);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt failed: ${message}`);
  }
}

export async function askYesNo(question: string, defaultValue = false): Promise<boolean> {
  try {
    const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
    const answer = (await ask(`${question}${suffix}`)).trim().toLowerCase();

    if (!answer) {
      return defaultValue;
    }

    return ["y", "yes"].includes(answer);
  } catch {
    // Fail safe when stdin is unavailable by falling back to the conservative default.
    return defaultValue;
  }
}

export async function pause(message: string): Promise<void> {
  try {
    await ask(`${message}\nPress Enter to continue... `);
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(`Interactive input is required for manual takeover. ${messageText}`);
  }
}

export function closePrompt(): void {
  readline.close();
}
