import { migrateLegacyAiProviderId, type AiProviderId } from "../providers";
import {
  extractThinkingTurns,
  normalizeAiAgentHistory,
  type AgentActionReceipt,
  type AgentToolCard,
  type AiAgentHistoryMessage,
} from "../agent-history";

/**
 * UI-only custom message types for the chat pane. These are never sent to the
 * LLM — the agent's `convertToLlm` filters them out — but the chat UI can render
 * them as tool cards, build progress indicators, and inline notifications.
 */
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    toolCard: { role: "tool_card"; toolName: string; args: unknown; result?: unknown; timestamp: number };
    buildProgress: { role: "build_progress"; step: string; status: "running" | "done" | "error"; detail?: string; timestamp: number };
    notification: { role: "notification"; text: string; kind: "info" | "success" | "error"; timestamp: number };
  }
}

export type LocalAgentProviderId = string;

export interface LocalAgentAttachmentMetadata {
  id: string;
  kind: "ticker";
  label: string;
  preview: string;
}

export interface LocalAgentAttachmentPayload extends LocalAgentAttachmentMetadata {
  content: string;
}

export interface LocalAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: "complete" | "cancelled" | "error";
  attachments?: LocalAgentAttachmentMetadata[];
  thinking?: string;
  toolCards?: AgentToolCard[];
  receipts?: AgentActionReceipt[];
}

export interface LocalAgentThread {
  id: string;
  providerId: LocalAgentProviderId;
  modelId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: LocalAgentMessage[];
  agentMessages: AiAgentHistoryMessage[];
}

export interface LocalAgentWorkspaceState {
  activeThreadId: string | null;
  threads: LocalAgentThread[];
}

export interface LocalAgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export const EMPTY_LOCAL_AGENT_WORKSPACE: LocalAgentWorkspaceState = {
  activeThreadId: null,
  threads: [],
};

const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 100;
const MAX_AGENT_MESSAGES_PER_THREAD = 300;
const LEGACY_PROVIDER_TITLES: Record<string, string> = {
  anthropic: "Claude",
  claude: "Claude",
  google: "Google Gemini",
  gemini: "Gemini",
  "openai-codex": "OpenAI",
  codex: "OpenAI",
  openai: "OpenAI API",
  "github-copilot": "GitHub Copilot",
  xai: "xAI / Grok",
  openrouter: "OpenRouter",
  opencode: "OpenCode",
  pi: "Pi",
};

function isProviderId(value: unknown): value is LocalAgentProviderId {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function providerTitle(providerId: string, providerLabel?: string): string {
  return providerLabel?.trim()
    || LEGACY_PROVIDER_TITLES[providerId]
    || providerId;
}

function normalizeMessage(value: unknown): LocalAgentMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<LocalAgentMessage>;
  if (
    typeof message.id !== "string"
    || (message.role !== "user" && message.role !== "assistant")
    || typeof message.content !== "string"
    || typeof message.createdAt !== "number"
  ) return null;
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.filter((attachment): attachment is LocalAgentAttachmentMetadata => (
      !!attachment
      && typeof attachment === "object"
      && typeof attachment.id === "string"
      && attachment.kind === "ticker"
      && typeof attachment.label === "string"
      && typeof attachment.preview === "string"
    ))
    : undefined;
  const status = message.status === "complete" || message.status === "cancelled" || message.status === "error"
    ? message.status
    : undefined;
  const thinking = typeof message.thinking === "string" && message.thinking.trim()
    ? message.thinking
    : undefined;
  const toolCards = normalizeToolCards(message.toolCards);
  const receipts = normalizeReceipts(message.receipts);
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(status ? { status } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(thinking ? { thinking } : {}),
    ...(toolCards.length ? { toolCards } : {}),
    ...(receipts.length ? { receipts } : {}),
  };
}

function normalizeReceipts(value: unknown): AgentActionReceipt[] {
  if (!Array.isArray(value)) return [];
  const receipts: AgentActionReceipt[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const receipt = entry as Partial<AgentActionReceipt>;
    if (
      typeof receipt.id !== "string"
      || typeof receipt.toolCallId !== "string"
      || typeof receipt.toolName !== "string"
      || typeof receipt.operation !== "string"
      || typeof receipt.label !== "string"
      || typeof receipt.undoable !== "boolean"
    ) continue;
    receipts.push({
      id: receipt.id,
      toolCallId: receipt.toolCallId,
      toolName: receipt.toolName,
      operation: receipt.operation,
      label: receipt.label,
      undoable: receipt.undoable,
    });
  }
  return receipts;
}

function normalizeToolCards(value: unknown): AgentToolCard[] {
  if (!Array.isArray(value)) return [];
  const cards: AgentToolCard[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const card = entry as Partial<AgentToolCard>;
    if (
      typeof card.id !== "string"
      || typeof card.toolName !== "string"
      || !isRecord(card.arguments)
      || (card.status !== "running" && card.status !== "success" && card.status !== "error")
      || typeof card.isError !== "boolean"
    ) continue;
    const result = typeof card.result === "string" ? card.result : undefined;
    cards.push({
      id: card.id,
      toolName: card.toolName,
      arguments: { ...card.arguments },
      status: card.status,
      isError: card.isError,
      ...(result ? { result } : {}),
    });
  }
  return cards;
}

function withBackfilledThinking(thread: LocalAgentThread): LocalAgentThread {
  const turns = extractThinkingTurns(thread.agentMessages);
  if (turns.length === 0) return thread;
  let turnIndex = 0;
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (message.role !== "assistant") return message;
    const fromHistory = turns[turnIndex++] ?? "";
    if (message.thinking || !fromHistory) return message;
    changed = true;
    return { ...message, thinking: fromHistory };
  });
  return changed ? { ...thread, messages } : thread;
}

function isThread(value: unknown): value is LocalAgentThread {
  if (!value || typeof value !== "object") return false;
  const thread = value as Partial<LocalAgentThread>;
  return typeof thread.id === "string"
    && isProviderId(thread.providerId)
    && typeof thread.title === "string"
    && typeof thread.createdAt === "number"
    && typeof thread.updatedAt === "number"
    && Array.isArray(thread.messages);
}

export function normalizeLocalAgentWorkspace(value: unknown): LocalAgentWorkspaceState {
  if (!value || typeof value !== "object") return EMPTY_LOCAL_AGENT_WORKSPACE;
  const candidate = value as Partial<LocalAgentWorkspaceState>;
  const threads = Array.isArray(candidate.threads)
    ? candidate.threads
      .filter(isThread)
      .map((thread) => ({
        ...thread,
        providerId: migrateLegacyAiProviderId(thread.providerId.trim()),
        modelId: typeof thread.modelId === "string" && thread.modelId.trim()
          ? thread.modelId.trim()
          : null,
        messages: thread.messages
          .map(normalizeMessage)
          .filter((message): message is LocalAgentMessage => message !== null)
          .slice(-MAX_MESSAGES_PER_THREAD),
        agentMessages: trimAgentMessages(normalizeAiAgentHistory(thread.agentMessages)),
      }))
      .map(withBackfilledThinking)
      .slice(0, MAX_THREADS)
    : [];
  const activeThreadId = typeof candidate.activeThreadId === "string"
    && threads.some((thread) => thread.id === candidate.activeThreadId)
    ? candidate.activeThreadId
    : threads[0]?.id ?? null;
  return { activeThreadId, threads };
}

export function createLocalAgentThread(
  state: LocalAgentWorkspaceState,
  providerId: AiProviderId,
  options: { id?: string; now?: number; modelId?: string | null; providerLabel?: string } = {},
): LocalAgentWorkspaceState {
  const now = options.now ?? Date.now();
  const id = options.id ?? crypto.randomUUID();
  const thread: LocalAgentThread = {
    id,
    providerId,
    modelId: options.modelId?.trim() || null,
    title: `New ${providerTitle(providerId, options.providerLabel)} thread`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    agentMessages: [],
  };
  return {
    activeThreadId: id,
    threads: [thread, ...state.threads].slice(0, MAX_THREADS),
  };
}

export function updateLocalAgentThread(
  state: LocalAgentWorkspaceState,
  threadId: string,
  updater: (thread: LocalAgentThread) => LocalAgentThread,
): LocalAgentWorkspaceState {
  let changed = false;
  const threads = state.threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const updated = updater(thread);
    changed = updated !== thread;
    // Runner identity is a creation-time property. Ignore accidental mutation.
    return updated.providerId === thread.providerId && updated.modelId === thread.modelId
      ? updated
      : { ...updated, providerId: thread.providerId, modelId: thread.modelId };
  });
  return changed ? { ...state, threads } : state;
}

export function appendLocalAgentMessages(
  state: LocalAgentWorkspaceState,
  threadId: string,
  messages: LocalAgentMessage[],
): LocalAgentWorkspaceState {
  if (messages.length === 0) return state;
  return updateLocalAgentThread(state, threadId, (thread) => {
    const nextMessages = [...thread.messages, ...messages].slice(-MAX_MESSAGES_PER_THREAD);
    const firstUserMessage = nextMessages.find((message) => message.role === "user")?.content.trim();
    return {
      ...thread,
      title: firstUserMessage
        ? firstUserMessage.replace(/\s+/g, " ").slice(0, 42)
        : thread.title,
      updatedAt: Math.max(thread.updatedAt, ...messages.map((message) => message.createdAt)),
      messages: nextMessages,
    };
  });
}

export function removeLocalAgentMessages(
  state: LocalAgentWorkspaceState,
  threadId: string,
  messageIds: readonly string[],
): LocalAgentWorkspaceState {
  const removed = new Set(messageIds);
  return updateLocalAgentThread(state, threadId, (thread) => ({
    ...thread,
    messages: thread.messages.filter((message) => !removed.has(message.id)),
  }));
}

export function buildLocalAgentHistory(
  thread: LocalAgentThread,
): LocalAgentHistoryMessage[] {
  return thread.messages
    .filter((message) => message.role === "user" || message.status === "complete")
    .map(({ role, content }) => ({ role, content }));
}

function trimAgentMessages(messages: AiAgentHistoryMessage[]): AiAgentHistoryMessage[] {
  if (messages.length <= MAX_AGENT_MESSAGES_PER_THREAD) return messages;
  const tail = messages.slice(-MAX_AGENT_MESSAGES_PER_THREAD);
  const firstUserIndex = tail.findIndex((message) => message.role === "user");
  return firstUserIndex > 0 ? tail.slice(firstUserIndex) : tail;
}

export function buildLocalAgentTranscript(
  thread: LocalAgentThread,
): AiAgentHistoryMessage[] {
  if (thread.agentMessages.length > 0) return thread.agentMessages;
  return buildLocalAgentHistory(thread).map((message): AiAgentHistoryMessage => (
    message.role === "user"
      ? { role: "user", content: message.content }
      : {
          role: "assistant",
          content: [{ type: "text", text: message.content }],
        }
  ));
}

export function appendLocalAgentTranscript(
  state: LocalAgentWorkspaceState,
  threadId: string,
  messages: AiAgentHistoryMessage[],
): LocalAgentWorkspaceState {
  if (messages.length === 0) return state;
  return updateLocalAgentThread(state, threadId, (thread) => ({
    ...thread,
    agentMessages: trimAgentMessages([
      ...thread.agentMessages,
      ...normalizeAiAgentHistory(messages),
    ]),
  }));
}

const MAX_ATTACHMENT_CHARS = 4_000;
const MAX_LIVE_DESK_CHARS = 2_500;
const MAX_LIVE_DESK_PANES = 40;

export interface LiveDeskPane {
  instanceId: string;
  paneId: string;
  title?: string;
  placement: "docked" | "floating" | "detached" | "hidden";
  focused: boolean;
  ticker?: string;
}

export interface LiveDeskSnapshot {
  layoutName: string | null;
  focusedPaneId: string | null;
  panes: LiveDeskPane[];
}

function clippedAttachmentContent(content: string): string {
  if (content.length <= MAX_ATTACHMENT_CHARS) return content;
  return `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n…[truncated ${content.length - MAX_ATTACHMENT_CHARS} chars]`;
}

export function formatLiveDeskContext(desk: LiveDeskSnapshot): string {
  const visible = desk.panes.filter((pane) => pane.placement !== "hidden");
  const hiddenCount = desk.panes.length - visible.length;
  const listed = visible.slice(0, MAX_LIVE_DESK_PANES);
  const lines = [
    `Live desk: ${desk.layoutName?.trim() || "untitled"}`,
    desk.focusedPaneId ? `Focused: ${desk.focusedPaneId}` : "Focused: none",
  ];
  for (const pane of listed) {
    const bits = [pane.paneId, pane.placement];
    if (pane.ticker) bits.push(pane.ticker);
    if (pane.focused) bits.push("focused");
    if (pane.title && pane.title !== pane.paneId) bits.push(pane.title);
    lines.push(`- ${pane.instanceId}: ${bits.join(" · ")}`);
  }
  if (visible.length > listed.length) {
    lines.push(`- +${visible.length - listed.length} more visible panes`);
  }
  if (hiddenCount > 0) lines.push(`- ${hiddenCount} hidden pane${hiddenCount === 1 ? "" : "s"}`);
  const text = lines.join("\n");
  if (text.length <= MAX_LIVE_DESK_CHARS) return text;
  return `${text.slice(0, MAX_LIVE_DESK_CHARS)}\n…[truncated]`;
}

export function buildLocalAgentRequestPrompt(
  userText: string,
  attachments: LocalAgentAttachmentPayload[],
  liveDesk?: LiveDeskSnapshot | string | null,
): string {
  const deskText = typeof liveDesk === "string"
    ? liveDesk
    : liveDesk && liveDesk.panes.length > 0
      ? formatLiveDeskContext(liveDesk)
      : "";
  const sections: string[] = [];
  if (deskText) {
    sections.push([
      "Live Gloomberb desk already on screen. Do not ask the user to attach panes.",
      deskText,
    ].join("\n"));
  }
  if (attachments.length > 0) {
    sections.push([
      "Extra ticker dump attached by the user for this request:",
      ...attachments.map((attachment) => `\n[${attachment.label}]\n${clippedAttachmentContent(attachment.content)}`),
    ].join("\n"));
  }
  sections.push(`Current user request:\n${userText.trim()}`);
  return sections.join("\n\n");
}
