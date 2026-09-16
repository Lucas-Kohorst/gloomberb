import { ProviderMissError } from "./provider-errors";

export class HistoryCoverageError extends ProviderMissError {
  constructor(reason: { message: string } | undefined = undefined) {
    super(reason?.message ?? "Requested price history is outside verified source coverage.");
    this.name = "HistoryCoverageError";
  }
}
