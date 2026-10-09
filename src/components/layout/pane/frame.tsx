import type { ReactNode } from "react";
import { Box } from "../../../ui";
import { colors } from "../../../theme/colors";
import { Spinner } from "../../ui/loading";
import { loadingText } from "../../ui/status";
import { usePaneBodySpinner } from "./body-loading";
import { PaneSurfaceContext } from "./surface";

export function getPaneWindowAttributes({
  enabled = true,
  role,
  paneId,
  floating,
  focused,
  windowModeSelected,
  showBorderColor = false,
}: {
  enabled?: boolean;
  role: string;
  paneId?: string;
  floating?: boolean;
  focused: boolean;
  windowModeSelected?: boolean;
  showBorderColor?: boolean;
}): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    "data-gloom-role": role,
  };
  if (paneId) attributes["data-gloom-pane-id"] = paneId;
  if (!enabled) return attributes;

  attributes["data-focused"] = focused ? "true" : "false";
  if (floating != null) attributes["data-floating"] = floating ? "true" : "false";
  if (windowModeSelected != null) {
    attributes["data-window-mode-selected"] = windowModeSelected ? "true" : "false";
  }
  if (showBorderColor) {
    attributes.style = {
      "--pane-border-color": focused || windowModeSelected ? colors.borderFocused : colors.border,
    };
  }
  return attributes;
}

/** Refresh and other in-flight work. A full-body status spinner covers this row. */
export function PaneBodyLoadingRow() {
  const show = usePaneBodySpinner();
  if (!show) return null;
  return (
    <Box paddingX={1} flexShrink={0}>
      <Spinner label={loadingText()} />
    </Box>
  );
}

export function PaneBodyFrame({
  layoutProps,
  backgroundColor,
  children,
}: {
  layoutProps: Record<string, unknown>;
  backgroundColor: string;
  children: ReactNode;
}) {
  return (
    <Box {...layoutProps} overflow="hidden" backgroundColor={backgroundColor} data-gloom-role="pane-body">
      <PaneSurfaceContext.Provider value={backgroundColor}>
        <PaneBodyLoadingRow />
        {children}
      </PaneSurfaceContext.Provider>
    </Box>
  );
}
