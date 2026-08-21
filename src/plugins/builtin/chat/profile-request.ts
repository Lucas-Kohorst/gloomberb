import type { ChatUserSummary } from "../../../api-client";

let pendingChatProfile: ChatUserSummary | null = null;
const snapshotListeners = new Set<() => void>();

function emitSnapshot(): void {
  for (const listener of snapshotListeners) listener();
}

export function requestOpenChatProfile(user: ChatUserSummary): void {
  pendingChatProfile = user;
  emitSnapshot();
}

export function consumePendingChatProfile(): ChatUserSummary | null {
  const user = pendingChatProfile;
  if (!pendingChatProfile) return user;
  pendingChatProfile = null;
  emitSnapshot();
  return user;
}

export function clearPendingChatProfile(): void {
  if (!pendingChatProfile) return;
  pendingChatProfile = null;
  emitSnapshot();
}

export function subscribeChatProfileSnapshot(onStoreChange: () => void): () => void {
  snapshotListeners.add(onStoreChange);
  return () => {
    snapshotListeners.delete(onStoreChange);
  };
}

export function getPendingChatProfile(): ChatUserSummary | null {
  return pendingChatProfile;
}
