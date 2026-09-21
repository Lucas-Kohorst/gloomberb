import type { ReactNode } from "react";
import { Box, useUiHost } from "../ui";
import { paneBodyPadStyle } from "../theme/spacing";

export function PaneBodyPad({
  children,
  fill = true,
}: {
  children: ReactNode;
  fill?: boolean;
}) {
  const kind = useUiHost().kind === "desktop-web" ? "desktop-web" : "opentui";
  const pad = paneBodyPadStyle(kind);
  return (
    <Box
      flexDirection="column"
      flexGrow={fill ? 1 : undefined}
      width="100%"
      padding={typeof pad.padding === "number" ? pad.padding : undefined}
      gap={typeof pad.gap === "number" ? pad.gap : undefined}
      style={kind === "desktop-web" ? { padding: pad.padding, gap: pad.gap, boxSizing: "border-box" } : undefined}
      data-gloom-role="pane-body-pad"
    >
      {children}
    </Box>
  );
}
