function timestamp(): string {
  return new Date().toISOString();
}

function log(level: string, message: string): void {
  console.log(`[${timestamp()}] [${level}] ${message}`);
}

export const logger = {
  info(message: string): void {
    log("INFO", message);
  },
  step(message: string): void {
    log("STEP", message);
  },
  warn(message: string): void {
    log("WARN", message);
  },
  error(message: string): void {
    log("ERROR", message);
  },
  success(message: string): void {
    log("OK", message);
  },
  divider(label?: string): void {
    const line = "=".repeat(72);

    console.log(line);
    if (label) {
      console.log(label);
      console.log(line);
    }
  }
};
