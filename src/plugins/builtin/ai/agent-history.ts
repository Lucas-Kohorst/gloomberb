export interface AiAgentTextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface AiAgentThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface AiAgentToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

export type AiAgentAssistantContent =
  | AiAgentTextContent
  | AiAgentThinkingContent
  | AiAgentToolCallContent;

export type AiAgentHistoryMessage =
  | {
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: AiAgentAssistantContent[];
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: AiAgentTextContent[];
      isError: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeAssistantContent(value: unknown): AiAgentAssistantContent | null {
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") {
    const textSignature = optionalString(value.textSignature);
    return {
      type: "text",
      text: value.text,
      ...(textSignature ? { textSignature } : {}),
    };
  }
  if (value.type === "thinking" && typeof value.thinking === "string") {
    const thinkingSignature = optionalString(value.thinkingSignature);
    return {
      type: "thinking",
      thinking: value.thinking,
      ...(thinkingSignature
        ? { thinkingSignature }
        : {}),
      ...(typeof value.redacted === "boolean" ? { redacted: value.redacted } : {}),
    };
  }
  if (
    value.type === "toolCall"
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isRecord(value.arguments)
  ) {
    const thoughtSignature = optionalString(value.thoughtSignature);
    return {
      type: "toolCall",
      id: value.id,
      name: value.name,
      arguments: { ...value.arguments },
      ...(thoughtSignature
        ? { thoughtSignature }
        : {}),
    };
  }
  return null;
}

function normalizeToolResultContent(value: unknown): AiAgentTextContent | null {
  if (!isRecord(value) || value.type !== "text" || typeof value.text !== "string") {
    return null;
  }
  const textSignature = optionalString(value.textSignature);
  return {
    type: "text",
    text: value.text,
    ...(textSignature ? { textSignature } : {}),
  };
}

function normalizeAiAgentHistoryMessage(value: unknown): AiAgentHistoryMessage | null {
  if (!isRecord(value)) return null;
  if (value.role === "user" && typeof value.content === "string") {
    return { role: "user", content: value.content };
  }
  if (value.role === "assistant" && Array.isArray(value.content)) {
    const content = value.content.map(normalizeAssistantContent);
    if (content.some((item) => item === null)) return null;
    return {
      role: "assistant",
      content: content as AiAgentAssistantContent[],
    };
  }
  if (
    value.role === "toolResult"
    && typeof value.toolCallId === "string"
    && typeof value.toolName === "string"
    && Array.isArray(value.content)
    && typeof value.isError === "boolean"
  ) {
    const content = value.content.map(normalizeToolResultContent);
    if (content.some((item) => item === null)) return null;
    return {
      role: "toolResult",
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      content: content as AiAgentTextContent[],
      isError: value.isError,
    };
  }
  return null;
}

export function normalizeAiAgentHistory(value: unknown): AiAgentHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeAiAgentHistoryMessage)
    .filter((message): message is AiAgentHistoryMessage => message !== null);
}

export function extractAssistantThinking(
  content: readonly AiAgentAssistantContent[],
): string {
  return content
    .filter((item): item is AiAgentThinkingContent => item.type === "thinking" && !item.redacted)
    .map((item) => item.thinking)
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
    .trim();
}

/** One string per user turn, covering every assistant thinking block in that turn. */
export function extractThinkingTurns(messages: readonly AiAgentHistoryMessage[]): string[] {
  const turns: string[] = [];
  let current: string[] = [];
  let sawAssistant = false;
  const flush = () => {
    if (!sawAssistant) return;
    turns.push(current.join("\n\n").trim());
    current = [];
    sawAssistant = false;
  };
  for (const message of messages) {
    if (message.role === "user") {
      flush();
      continue;
    }
    if (message.role === "assistant") {
      sawAssistant = true;
      const thinking = extractAssistantThinking(message.content);
      if (thinking) current.push(thinking);
    }
  }
  flush();
  return turns;
}

export function extractTurnThinking(messages: readonly AiAgentHistoryMessage[]): string {
  const turns = extractThinkingTurns(messages);
  return turns.at(-1) ?? "";
}

export interface AgentToolCard {
  /** The toolCall content-block id — stable across reloads. */
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "running" | "success" | "error";
  /** Joined toolResult text, truncated at render time. Absent while running. */
  result?: string;
  isError: boolean;
}

/**
 * Walk an `AiAgentHistoryMessage[]` slice and emit one card per `toolCall`
 * content block, paired with its `toolResult` by `toolCallId`. A card whose id
 * has no matching result stays `"running"` (cancelled or mid-flight). Tool
 * results whose id matches no call are dropped defensively.
 *
 * Pure and deterministic: produces the same output on reload from the
 * persisted `agentMessages` as it did live.
 */
export function extractToolCards(
  messages: readonly AiAgentHistoryMessage[],
): AgentToolCard[] {
  const cards: AgentToolCard[] = [];
  const byId = new Map<string, AgentToolCard>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const card: AgentToolCard = {
          id: block.id,
          toolName: block.name,
          arguments: block.arguments,
          status: "running",
          isError: false,
        };
        cards.push(card);
        byId.set(block.id, card);
      }
      continue;
    }
    if (message.role === "toolResult") {
      const card = byId.get(message.toolCallId);
      if (!card) continue;
      const result = message.content
        .map((item) => item.text)
        .filter((text) => text.length > 0)
        .join("\n");
      card.isError = message.isError;
      card.status = message.isError ? "error" : "success";
      if (result) card.result = result;
    }
  }
  return cards;
}

export interface AgentActionReceipt {
  id: string;
  toolCallId: string;
  toolName: string;
  operation: string;
  label: string;
  undoable: boolean;
}

const UNDOABLE_OPERATIONS = new Set([
  "pane.show",
  "pane.close",
  "pane.createFromTemplate",
  "layout.switch",
  "layout.new",
  "layout.rename",
  "layout.duplicate",
  "layout.delete",
  "layout.gridlock",
  "layout.closeFloating",
  "layout.placePane",
  "layout.focusRegion",
  "layout.setGrid",
]);

function remoteOperationFromArguments(args: Record<string, unknown>): string | null {
  const nested = args.request;
  if (isRecord(nested) && nested.type === "call" && typeof nested.operation === "string") {
    return nested.operation;
  }
  if (typeof args.operation === "string") return args.operation;
  return null;
}

function showOperationFromArguments(args: Record<string, unknown>): string {
  if (typeof args.templateId === "string" && args.templateId.trim()) return "pane.createFromTemplate";
  return "pane.show";
}

function receiptLabel(toolName: string, operation: string, args: Record<string, unknown>): string {
  if (operation === "pane.createFromTemplate") {
    const templateId = typeof args.templateId === "string"
      ? args.templateId
      : isRecord(args.request) && isRecord(args.request.input) && typeof args.request.input.templateId === "string"
        ? args.request.input.templateId
        : "template";
    return `created pane from ${templateId}`;
  }
  if (operation === "pane.show") {
    const paneId = typeof args.paneId === "string"
      ? args.paneId
      : isRecord(args.request) && isRecord(args.request.input) && typeof args.request.input.paneId === "string"
        ? args.request.input.paneId
        : "pane";
    return `opened ${paneId}`;
  }
  if (operation === "layout.new") {
    const name = isRecord(args.request) && isRecord(args.request.input) && typeof args.request.input.name === "string"
      ? args.request.input.name
      : "layout";
    return `created layout “${name}”`;
  }
  if (operation.startsWith("layout.")) return operation.replace("layout.", "layout ");
  if (toolName === "gloomberb_show") return "opened pane";
  return operation;
}

export function extractActionReceipts(
  messages: readonly AiAgentHistoryMessage[],
): AgentActionReceipt[] {
  const receipts: AgentActionReceipt[] = [];
  for (const card of extractToolCards(messages)) {
    if (card.status !== "success" || card.isError) continue;
    if (card.toolName !== "gloomberb_remote" && card.toolName !== "gloomberb_show") continue;
    const operation = card.toolName === "gloomberb_show"
      ? showOperationFromArguments(card.arguments)
      : remoteOperationFromArguments(card.arguments);
    if (!operation) continue;
    receipts.push({
      id: card.id,
      toolCallId: card.id,
      toolName: card.toolName,
      operation,
      label: receiptLabel(card.toolName, operation, card.arguments),
      undoable: UNDOABLE_OPERATIONS.has(operation),
    });
  }
  return receipts;
}
