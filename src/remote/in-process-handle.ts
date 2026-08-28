import { sendRemoteControlRequest } from "./client";
import type { RemoteAppKind, RemoteControlRequest, RemoteControlResponse } from "./types";

export type RemoteControlHandler = (
  request: RemoteControlRequest,
) => Promise<RemoteControlResponse>;

let handle: RemoteControlHandler | null = null;

export function setInProcessRemoteHandle(next: RemoteControlHandler | null): void {
  handle = next;
}

export function getInProcessRemoteHandle(): RemoteControlHandler | null {
  return handle;
}

export async function sendInProcessOrRemoteControlRequest(
  request: RemoteControlRequest,
  options: { dataDir: string; appKind?: RemoteAppKind },
): Promise<RemoteControlResponse> {
  if (handle) return handle(request);
  return sendRemoteControlRequest(request, options);
}
