import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";

/**
 * Runs broker.validate without turning thrown errors into the generic
 * "setup is incomplete" message. Incomplete is only for a false return
 * (missing required fields). Transport / hosted / OAuth failures must
 * surface as themselves.
 */
export async function requireValidBroker(
  broker: BrokerAdapter,
  instance: BrokerInstanceConfig,
): Promise<void> {
  const valid = await broker.validate(instance);
  if (valid) return;
  if (broker.id === "robinhood") {
    throw new Error(
      "Robinhood sign-in is not ready. Choose Robinhood sign-in (read accounts, trade Agentic) and connect again.",
    );
  }
  throw new Error(`${broker.name} setup is incomplete.`);
}
