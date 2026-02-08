import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class SdkHooksManager {
  constructor(outputDir) {
    this.tracesDir = join(outputDir, 'traces');
    this.toolCalls = [];
    this.cacheMetrics = { inputTokens: 0, cacheReadTokens: 0 };
  }

  async init() {
    await mkdir(this.tracesDir, { recursive: true });
  }

  getHooksConfig() {
    return {
      onToolCall: (toolName, input) => {
        this.toolCalls.push({
          name: toolName,
          startedAt: Date.now(),
          input: typeof input === 'string' ? input.substring(0, 200) : undefined,
        });
      },
      onToolResult: (toolName, output) => {
        const lastCall = this.toolCalls.findLast(c => c.name === toolName && !c.completedAt);
        if (lastCall) {
          lastCall.completedAt = Date.now();
          lastCall.durationMs = lastCall.completedAt - lastCall.startedAt;
        }
      },
    };
  }

  recordUsage(usage) {
    if (usage) {
      this.cacheMetrics.inputTokens += usage.input_tokens || 0;
      this.cacheMetrics.cacheReadTokens += usage.cache_read_tokens || 0;
    }
  }

  async saveTrace(stepName) {
    const trace = {
      step: stepName,
      savedAt: new Date().toISOString(),
      toolCalls: this.toolCalls,
      cacheMetrics: {
        ...this.cacheMetrics,
        cacheEfficiency: this.cacheMetrics.inputTokens > 0
          ? ((this.cacheMetrics.cacheReadTokens / this.cacheMetrics.inputTokens) * 100).toFixed(1) + '%'
          : '0%',
      },
    };

    const tracePath = join(this.tracesDir, 'session_trace.json');
    await writeFile(tracePath, JSON.stringify(trace, null, 2), 'utf8');
  }
}
