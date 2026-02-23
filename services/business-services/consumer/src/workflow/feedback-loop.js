import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executeStep } from './agent-workflow.js';

const execFileAsync = promisify(execFile);

const MAX_FEEDBACK_ROUNDS = 2;
const COMMAND_TIMEOUT_MS = 120000;
const MAX_ERROR_LENGTH = 3000;

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... (truncated, ${str.length - max} chars omitted)`;
}

async function runCommand(command, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
    });
    return { passed: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    return { passed: false, output: truncate(output, MAX_ERROR_LENGTH) };
  }
}

/**
 * Runs feedback commands in tiers:
 *   Tier 1: lint, typecheck (fast, run together)
 *   Tier 2: test (slower, only if Tier 1 passes)
 *
 * Returns { passed, tier, command, output } for the first failure, or null if all pass.
 */
async function runAllCommands(feedbackCommands, cwd) {
  const tier1 = ['lint', 'typecheck'].filter(k => feedbackCommands[k]);
  const tier2 = ['test'].filter(k => feedbackCommands[k]);

  // Tier 1: lint + typecheck
  for (const key of tier1) {
    const result = await runCommand(feedbackCommands[key], cwd);
    if (!result.passed) {
      return { passed: false, tier: 1, command: key, output: result.output };
    }
  }

  // Tier 2: test (skip if Tier 1 failed)
  for (const key of tier2) {
    const result = await runCommand(feedbackCommands[key], cwd);
    if (!result.passed) {
      return { passed: false, tier: 2, command: key, output: result.output };
    }
  }

  return { passed: true };
}

/**
 * Runs the feedback loop: execute commands, and if they fail, re-run the agent
 * with error context up to MAX_FEEDBACK_ROUNDS times.
 *
 * @param {Object} options
 * @param {Object} options.feedbackCommands - { lint?: string, typecheck?: string, test?: string }
 * @param {string} options.repoDir - Working directory for commands
 * @param {Object} options.originalStep - The original executeStep config
 * @param {string} options.outputDir - Output directory for agent artifacts
 * @param {Object} options.logger - WorkflowLogger instance
 * @returns {{ passed: boolean, rounds: number, lastFailure?: Object }}
 */
export async function runFeedbackLoop({ feedbackCommands, repoDir, originalStep, outputDir, logger }) {
  let rounds = 0;

  for (let round = 1; round <= MAX_FEEDBACK_ROUNDS + 1; round++) {
    rounds = round;
    logger.info(`Feedback round ${round}: running checks`);

    const checkResult = await runAllCommands(feedbackCommands, repoDir);

    if (checkResult.passed) {
      logger.info(`Feedback round ${round}: all checks passed`);
      return { passed: true, rounds };
    }

    logger.info(`Feedback round ${round}: ${checkResult.command} failed (tier ${checkResult.tier})`);

    // If this is the last round, don't retry — return failure
    if (round > MAX_FEEDBACK_ROUNDS) {
      logger.info(`Feedback: max rounds (${MAX_FEEDBACK_ROUNDS}) exceeded, giving up`);
      return {
        passed: false,
        rounds,
        lastFailure: {
          command: checkResult.command,
          tier: checkResult.tier,
          output: checkResult.output,
        },
      };
    }

    // Re-run agent with error context
    const fixPrompt = [
      originalStep.constructedPrompt,
      '',
      '# Feedback — Fix Required',
      `The \`${checkResult.command}\` command (\`${feedbackCommands[checkResult.command]}\`) failed:`,
      '```',
      checkResult.output,
      '```',
      `Please fix the issues and ensure \`${feedbackCommands[checkResult.command]}\` passes.`,
    ].join('\n');

    logger.info(`Feedback round ${round}: re-running agent to fix ${checkResult.command} errors`);

    await executeStep({
      ...originalStep,
      constructedPrompt: fixPrompt,
      name: `${originalStep.name}-fix-${round}`,
    }, outputDir, repoDir);
  }

  // Should not reach here, but just in case
  return { passed: false, rounds };
}
