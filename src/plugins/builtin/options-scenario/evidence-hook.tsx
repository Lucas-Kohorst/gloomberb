import { useRemoteUiNode } from "../../../remote/semantic-tree";
import { scenarioSemanticEvidence, type ScenarioEvidenceInput } from "./evidence";

/** Uses the active pane's actual chart, table and position inputs. */
export function useScenarioEvidence(input: ScenarioEvidenceInput): void {
  useRemoteUiNode({ role: "chart-data", label: "Rendered option scenario observations",
    getMetadata: () => ({ ...scenarioSemanticEvidence(input), ready: !input.loading }) });
}
