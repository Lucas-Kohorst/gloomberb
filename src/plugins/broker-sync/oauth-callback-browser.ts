import {
  ROBINHOOD_HOSTED_CALLBACK_PATH,
  ROBINHOOD_OAUTH_CHANNEL,
  ROBINHOOD_OAUTH_MESSAGE_SOURCE,
} from "../../shared/robinhood-oauth";
import type { OAuthCallback } from "./oauth-callback";

interface RobinhoodOAuthMessage {
  source?: string;
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

function isRobinhoodOAuthMessage(value: unknown): value is RobinhoodOAuthMessage {
  return !!value && typeof value === "object" && (value as RobinhoodOAuthMessage).source === ROBINHOOD_OAUTH_MESSAGE_SOURCE;
}

export async function startBrowserOAuthCallback(expectedState: string): Promise<OAuthCallback> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    action();
  };
  const accept = (payload: RobinhoodOAuthMessage) => {
    if (payload.error) {
      finish(() => rejectCode(new Error(`Robinhood sign-in failed: ${payload.error}.`)));
      return;
    }
    if (!payload.code || payload.state !== expectedState) {
      finish(() => rejectCode(new Error("Gloomberb could not verify the Robinhood sign-in response.")));
      return;
    }
    finish(() => resolveCode(payload.code!));
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (!isRobinhoodOAuthMessage(event.data)) return;
    accept(event.data);
  };
  window.addEventListener("message", onMessage);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(ROBINHOOD_OAUTH_CHANNEL);
    channel.onmessage = (event) => {
      if (!isRobinhoodOAuthMessage(event.data)) return;
      accept(event.data);
    };
  } catch {
    channel = null;
  }
  const timeout = setTimeout(() => {
    finish(() => rejectCode(new Error("Robinhood sign-in timed out.")));
  }, 5 * 60_000);
  return {
    redirectUrl: `${window.location.origin}${ROBINHOOD_HOSTED_CALLBACK_PATH}`,
    code,
    close: async () => {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      channel?.close();
    },
  };
}

export async function openAuthorizationPopup(url: URL): Promise<void> {
  const popup = window.open(url.toString(), "gloomberb-robinhood-oauth", "popup,width=480,height=720");
  if (!popup) {
    throw new Error("Allow popups for this site, then connect Robinhood again.");
  }
}
