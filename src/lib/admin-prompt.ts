export type AdminPrompt = {
  /** File plus the named section inside it. */
  where: string;
  /** The concrete change, with the current values inline. */
  what: string;
  /** The invariants the change must not break. */
  guardrails: string[];
  /** Commands to run, and which customize skill to load. */
  verify: string[];
};

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/** Agent-ready markdown: four bold-labeled parts, no preamble, no headings. */
export function formatAdminPrompt(prompt: AdminPrompt): string {
  return [
    `**Where:** ${prompt.where}`,
    `**What:** ${prompt.what}`,
    `**Guardrails:**\n${bulletList(prompt.guardrails)}`,
    `**Verify:**\n${bulletList(prompt.verify)}`,
  ].join('\n\n');
}
