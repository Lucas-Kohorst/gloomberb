const drafts = new Map<string, string>();

export function queueAskGloomDraft(prompt: string): string | undefined {
  const text = prompt.trim();
  if (!text) return undefined;
  const id = crypto.randomUUID();
  drafts.set(id, text);
  return id;
}

export function consumeAskGloomDraft(id: string): string | undefined {
  const text = drafts.get(id);
  drafts.delete(id);
  return text;
}
