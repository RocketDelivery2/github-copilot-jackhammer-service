import type { CommandQueueItem, CopilotGuidance } from './types.js';

// Patterns that indicate Copilot is asking a clarifying question.
const COPILOT_QUESTION_PATTERNS: RegExp[] = [
  /which direction would you like to go/i,
  /could you clarify/i,
  /can you clarify/i,
  /please clarify/i,
  /would you like me to/i,
  /should i proceed/i,
  /do you want me to/i,
  /let me know (which|how|what|if)/i,
  /which (option|approach|path|choice) (would you|do you) prefer/i,
  /please (choose|select|confirm|specify)/i,
  /\?\s*$/, // ends with a question mark (as a fallback)
];

// Phrases that are wrapper text to be stripped from Copilot commands.
const WRAPPER_PHRASES: RegExp[] = [
  /^Generate this into a copilot command[:\s]*/im,
  /^Here is your copilot command[:\s]*/im,
  /^Copilot command[:\s]*/im,
  /^The following is a copilot command[:\s]*/im,
  /^Below is a copilot command[:\s]*/im,
];

/**
 * Returns true if the text contains a Copilot clarifying question.
 */
export function detectCopilotQuestion(text: string): boolean {
  return COPILOT_QUESTION_PATTERNS.some(p => p.test(text));
}

/**
 * Extracts numbered Plan Steps from a text block.
 * Looks for a "Plan Steps" heading followed by numbered items.
 * Falls back to global numbered-item search if no section is found.
 */
export function extractPlanSteps(text: string): string[] {
  const lines = text.split('\n');
  let inSection = false;
  const steps: string[] = [];

  for (const line of lines) {
    // Detect Plan Steps heading.
    if (/^#+\s*Plan\s+Steps?[:\s]*$/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    // Stop at the next heading.
    if (inSection && /^#+\s/.test(line)) break;

    if (inSection) {
      const m = line.match(/^\s*(?:Step\s+)?\d+[.)]\s+(.+)$/);
      if (m) steps.push(m[1].trim());
    }
  }

  // Fallback: search globally for numbered items when no section header found.
  if (steps.length === 0) {
    for (const m of text.matchAll(/^\s*(?:Step\s+)?\d+[.)]\s+(.+)$/gm)) {
      steps.push(m[1].trim());
    }
  }

  return steps;
}

/**
 * Extracts the Recommended Next PR value from a text block.
 * Returns the first match or null.
 */
export function extractRecommendedNextPR(text: string): string | null {
  const match = text.match(/Recommended\s+Next\s+PR[:\s]+(.+?)(?:\n|$)/i);
  return match ? match[1].trim() : null;
}

/**
 * Extracts lines from a named section (Notes, Validation, Blockers, Errors).
 * Uses line-by-line parsing to handle multi-line sections reliably.
 */
function extractSection(text: string, sectionName: string): string[] {
  const lines = text.split('\n');
  let inSection = false;
  const items: string[] = [];

  for (const line of lines) {
    // Match a Markdown heading (##, ###, etc.) or a bare "SectionName:" label.
    const headingText = line.match(/^#+\s*(.+)$/)?.[1]?.trim()
      ?? (line.match(new RegExp(`^${sectionName}\\s*:?\\s*$`, 'i')) ? sectionName : null);

    if (headingText !== null) {
      if (inSection) break; // End of the target section — next heading arrived.
      if (headingText.toLowerCase() === sectionName.toLowerCase()) {
        inSection = true;
      }
      continue;
    }

    if (inSection) {
      const cleaned = line.replace(/^[\s\-*•]+/, '').trim();
      if (cleaned) items.push(cleaned);
    }
  }

  return items;
}

export function extractNotes(text: string): string[] {
  return extractSection(text, 'Notes');
}

export function extractValidation(text: string): string[] {
  return extractSection(text, 'Validation');
}

export function extractBlockers(text: string): string[] {
  return extractSection(text, 'Blockers');
}

export function extractErrors(text: string): string[] {
  return extractSection(text, 'Errors');
}

/**
 * Strips known wrapper phrases from the beginning of a Copilot command text.
 */
export function stripWrapperText(text: string): string {
  let result = text;
  for (const pattern of WRAPPER_PHRASES) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

/**
 * Ensures that a generated Copilot prompt contains a Notes section.
 * If absent, appends a default "Notes:\n- None." block.
 */
export function ensureNotesSection(prompt: string): string {
  if (/^Notes:/im.test(prompt)) return prompt;
  return `${prompt.trimEnd()}\n\nNotes:\n- None.`;
}

/**
 * Extracts all relevant guidance from a Copilot response body (issue body or comment).
 */
export function extractCopilotGuidance(text: string): CopilotGuidance {
  return {
    planSteps: extractPlanSteps(text),
    recommendedNextPR: extractRecommendedNextPR(text),
    notes: extractNotes(text),
    validation: extractValidation(text),
    blockers: extractBlockers(text),
    errors: extractErrors(text),
    hasCopilotQuestion: detectCopilotQuestion(text),
    rawText: text,
    extractedAt: new Date().toISOString(),
  };
}

type RebalanceSignals = {
  guidance: CopilotGuidance | null;
  failedChecks: boolean;
  hasTests: boolean;
  hasBuildIssue: boolean;
  hasLintIssue: boolean;
  isProductionReady: boolean;
};

/**
 * Rebalances a command queue based on priority signals.
 * Returns a new array sorted by computed priority (high items first).
 */
export function rebalanceQueue(
  queue: CommandQueueItem[],
  signals: RebalanceSignals,
): CommandQueueItem[] {
  const { guidance, failedChecks, hasBuildIssue, hasLintIssue } = signals;
  const recommendedTitle = guidance?.recommendedNextPR?.toLowerCase() ?? null;
  const blockers = guidance?.blockers.map(b => b.toLowerCase()) ?? [];

  function scoreItem(item: CommandQueueItem): number {
    const title = item.title.toLowerCase();
    const prompt = item.prompt.toLowerCase();

    // Recommended Next PR gets the top spot.
    if (recommendedTitle && (title.includes(recommendedTitle) || recommendedTitle.includes(title))) {
      return -1000;
    }

    // Items blocked by known blockers are deprioritised.
    if (blockers.some(b => title.includes(b) || prompt.includes(b))) {
      return 1000;
    }

    let score = 0;

    // Boost build/lint fixers when there are failures.
    if (hasBuildIssue && (title.includes('build') || prompt.includes('build'))) score -= 50;
    if (hasLintIssue && (title.includes('lint') || prompt.includes('lint'))) score -= 40;

    // Boost test items when checks are failing.
    if (failedChecks && (title.includes('test') || prompt.includes('test'))) score -= 30;

    // Priority field from AI.
    if (item.priority === 'high') score -= 20;
    else if (item.priority === 'medium') score -= 10;

    return score;
  }

  return [...queue].sort((a, b) => scoreItem(a) - scoreItem(b));
}
