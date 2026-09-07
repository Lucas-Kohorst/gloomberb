import { useNativeRenderer } from "../../../ui";
import { useOptionalAppSelector } from "../../../state/app/context";
import type { ChartRendererPreference } from "../core/types";
import { useResolvedChartRendererState } from "./renderer-selection";

/**
 * Cell-character plot text is only visible when kitty is not the active chart
 * renderer. Skip rebuilding braille/ASCII fallback while the native bitmap is
 * on screen.
 */
export function useShowChartTextFallback(): boolean {
  const renderer = useNativeRenderer();
  const preferredRenderer = useOptionalAppSelector<ChartRendererPreference>(
    (state) => state.config.chartPreferences.renderer,
    "braille",
  );
  const rendererState = useResolvedChartRendererState(preferredRenderer, renderer);
  return rendererState.renderer !== "kitty";
}
