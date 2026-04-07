import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { withRetry } from '../utils/retry.js';
import { SdkHooksManager } from './sdk-hooks-manager.js';

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT || '600000', 10);
const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 15 * 60 * 1000;

function clampTimeout(timeout) {
  return Math.max(MIN_TIMEOUT, Math.min(timeout, MAX_TIMEOUT));
}

export async function executeStep(step, outputDir, cwd) {
  const hooksManager = new SdkHooksManager(outputDir);
  await hooksManager.init();

  const timeout = clampTimeout(step.timeout || DEFAULT_TIMEOUT);
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeout);

  try {
    const result = await withRetry(async () => {
      const generator = sdkQuery({
        prompt: step.constructedPrompt,
        options: {
          model: step.model || CLAUDE_MODEL,
          maxTurns: step.maxTurns || 10,
          permissionMode: 'bypassPermissions',
          cwd: cwd || process.cwd(),
          hooks: hooksManager.getHooksConfig(),
          allowedTools: step.tools || [],
          abortController,
          ...(step.outputSchema && {
            outputFormat: {
              type: 'json_schema',
              schema: step.outputSchema,
            },
          }),
        },
      });

      let finalResult = null;
      let lastAssistantText = '';

      for await (const message of generator) {
        // Capture assistant text from conversation messages
        if (message.type === 'assistant') {
          const content = message.message?.content || message.content;
          if (Array.isArray(content)) {
            const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text) lastAssistantText = text;
          } else if (typeof content === 'string' && content) {
            lastAssistantText = content;
          }
        }

        if (message.type === 'result') {
          const sdkOutput = message.structured_output || message.result || message.output;
          const effectiveOutput = sdkOutput || lastAssistantText || '';

          finalResult = {
            output: effectiveOutput,
            usage: {
              inputTokens: message.usage?.input_tokens || 0,
              outputTokens: message.usage?.output_tokens || 0,
              cacheReadTokens: message.usage?.cache_read_tokens || 0,
            },
            durationMs: message.duration_ms || 0,
            numTurns: message.num_turns || 0,
          };
          hooksManager.recordUsage(message.usage);
        }
      }

      if (!finalResult) {
        throw new Error('No result from Claude SDK');
      }

      return finalResult;
    }, { maxAttempts: 3 });

    await hooksManager.saveTrace(step.name);

    // Post-processing
    if (step.processOutput && result.output) {
      result.output = await step.processOutput(result.output);
    }

    return result;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
