import {
  AI_RUNNER_CAPABILITY_ID,
  type AiRunnerEvent,
} from "../../../capabilities";
import { createBrowserAiRunHost } from "../../../plugins/builtin/ai/browser";
import {
  AiRunCancelledError,
  installAiRunHost,
  type AiAuthProgressEvent,
  type AiRunHost,
  type AiRuntimeAuthType,
  type AiRuntimeCatalog,
} from "../../../plugins/builtin/ai/runner";
import { isHostedWebClient } from "../../../shared/hosted-api";
import { debugLog } from "../../../utils/debug-log";
import { backendRequest, onCapabilityEvent } from "./backend-rpc";

const AI_STARTUP_READINESS_TIMEOUT_MS = 5_000;
const aiHostLog = debugLog.createLogger("electrobun-ai-host");
let nextRunId = 1;

function connectProvider(
  providerId: string,
  authType?: AiRuntimeAuthType,
  onAuthEvent?: (event: AiAuthProgressEvent) => void,
): Promise<AiRuntimeCatalog> {
  const subscriptionId = `ai-login:${nextRunId++}`;
  let settled = false;
  let disposeMessages: () => void = () => {};
  let resolveDone: (catalog: AiRuntimeCatalog) => void = () => {};
  let rejectDone: (error: unknown) => void = () => {};
  const cleanup = () => {
    disposeMessages();
    void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
  };
  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const done = new Promise<AiRuntimeCatalog>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  disposeMessages = onCapabilityEvent(subscriptionId, (message) => {
    const event = message.event as AiRunnerEvent;
    if (event.kind === "account-connected") {
      settle(() => resolveDone(event.catalog as AiRuntimeCatalog));
    } else if (event.kind === "account-auth") {
      onAuthEvent?.(event.event);
    } else if (event.kind === "account-error") {
      settle(() => rejectDone(new Error(event.error)));
    }
  });
  void backendRequest("capability.subscribe", {
    subscriptionId,
    capabilityId: AI_RUNNER_CAPABILITY_ID,
    operationId: "connectProvider",
    payload: { providerId, authType },
  }).catch((error) => {
    settle(() => rejectDone(error));
  }).finally(() => {
    if (settled) void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
  });
  return done;
}

export function installElectrobunAiHost(): void {
  if (isHostedWebClient()) {
    void installAiRunHost(createBrowserAiRunHost(), {
      catalogTimeoutMs: AI_STARTUP_READINESS_TIMEOUT_MS,
      timeoutMessage: "In-app AI provider discovery timed out during hosted startup",
      onCatalogError(error) {
        aiHostLog.warn("Hosted browser AI discovery could not finish during startup", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }).catch((error) => {
      aiHostLog.warn("Hosted browser AI could not be initialized", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  const host: AiRunHost = {
    getCatalog() {
      return backendRequest("capability.invoke", {
        capabilityId: AI_RUNNER_CAPABILITY_ID,
        operationId: "getCatalog",
        payload: {},
      });
    },
    connect(providerId, authType, onAuthEvent) {
      return connectProvider(providerId, authType, onAuthEvent);
    },
    disconnect(providerId) {
      return backendRequest("capability.invoke", {
        capabilityId: AI_RUNNER_CAPABILITY_ID,
        operationId: "disconnectProvider",
        payload: { providerId },
      });
    },
    checkStatus(providerId) {
      return backendRequest("capability.invoke", {
        capabilityId: AI_RUNNER_CAPABILITY_ID,
        operationId: "checkProviderStatus",
        payload: { providerId },
      });
    },
    run({
      providerId,
      prompt,
      messages,
      agentMessages,
      modelId,
      onChunk,
      onAgentMessages,
      outputMode,
    }) {
      const subscriptionId = `ai-run:${nextRunId++}`;
      let disposed = false;
      let settled = false;
      let disposeMessages: () => void = () => {};
      let resolveDone: (output: string) => void = () => {};
      let rejectDone: (error: unknown) => void = () => {};

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        disposeMessages();
        void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const done = new Promise<string>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });

      disposeMessages = onCapabilityEvent(subscriptionId, (message) => {
        const event = message.event as AiRunnerEvent;
        switch (event.kind) {
          case "chunk":
            onChunk?.(event.output);
            break;
          case "done":
            settle(() => {
              if (event.agentMessages) onAgentMessages?.(event.agentMessages);
              resolveDone(event.output);
            });
            break;
          case "cancelled":
            settle(() => rejectDone(new AiRunCancelledError()));
            break;
          case "error":
            settle(() => rejectDone(new Error(event.error)));
            break;
          case "account-connected":
          case "account-auth":
          case "account-error":
            break;
        }
      });

      const subscribePromise = backendRequest("capability.subscribe", {
        subscriptionId,
        capabilityId: AI_RUNNER_CAPABILITY_ID,
        operationId: "run",
        payload: {
          providerId,
          prompt,
          messages,
          agentMessages,
          modelId,
          outputMode,
        },
      }).catch((error) => {
        settle(() => rejectDone(error));
      }).finally(() => {
        // Cancellation can race the async subscribe. Unsubscribe again after it
        // settles so a late backend subscription cannot outlive this run.
        if (disposed) {
          void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
        }
      });
      void subscribePromise;

      return {
        done,
        cancel() {
          settle(() => rejectDone(new AiRunCancelledError()));
        },
      };
    },
  };
  void installAiRunHost(host, {
    catalogTimeoutMs: AI_STARTUP_READINESS_TIMEOUT_MS,
    timeoutMessage: "In-app AI provider discovery timed out during desktop startup",
    onCatalogError(error) {
      aiHostLog.warn("In-app AI provider discovery could not finish during desktop startup", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  }).catch((error) => {
    aiHostLog.warn("In-app AI providers could not be initialized", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
