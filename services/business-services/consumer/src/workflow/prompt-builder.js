import { sanitizePromptInput } from '../security/index.js';

export function buildPrompt({ taskDefinition, input, dependencyOutputs, iteration, previousOutput, reviewFeedback }) {
  const sections = [
    `# Role\nYou are a ${taskDefinition.tag}.`,
    `# Task\n${taskDefinition.description}`,
  ];

  const sanitizedInput = sanitizePromptInput(input);
  if (sanitizedInput && Object.keys(sanitizedInput).length > 0) {
    sections.push(`# Input\n${JSON.stringify(sanitizedInput, null, 2)}`);
  }

  if (dependencyOutputs && Object.keys(dependencyOutputs).length > 0) {
    const sanitizedOutputs = sanitizePromptInput(dependencyOutputs);
    sections.push(`# Context from Previous Tasks\n${JSON.stringify(sanitizedOutputs, null, 2)}`);
  }

  // Revision context — only present on iteration 2+
  if (iteration > 1 && previousOutput) {
    const sanitizedPrev = sanitizePromptInput(previousOutput);
    sections.push(`# Previous Output (Iteration ${iteration - 1})\n${JSON.stringify(sanitizedPrev, null, 2)}`);
  }
  if (reviewFeedback) {
    const sanitizedFeedback = sanitizePromptInput(reviewFeedback);
    sections.push(`# Reviewer Feedback\nThe reviewer requested the following changes:\n${sanitizedFeedback}`);
  }

  return sections.join('\n\n');
}
