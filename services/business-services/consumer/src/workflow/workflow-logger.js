import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class WorkflowLogger {
  constructor(requestId, outputDir) {
    this.requestId = requestId;
    this.logDir = join(outputDir, 'logs');
    this.entries = [];
  }

  async init() {
    await mkdir(this.logDir, { recursive: true });
  }

  log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      requestId: this.requestId,
      message,
      ...data,
    };
    this.entries.push(entry);
    console.log(`[WORKFLOW:${this.requestId}] [${level}] ${message}`);
  }

  info(message, data) { this.log('INFO', message, data); }
  warn(message, data) { this.log('WARN', message, data); }
  error(message, data) { this.log('ERROR', message, data); }

  async flush() {
    const logPath = join(this.logDir, 'summary.log');
    const content = this.entries.map(e =>
      `${e.timestamp} [${e.level}] ${e.message}`
    ).join('\n');
    await writeFile(logPath, content, 'utf8');
  }
}
