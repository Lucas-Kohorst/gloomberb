
const PANE_HEADER_ROWS = 1;
const PANE_FOOTER_ROWS = 1;
/** Native/web title bars are taller than one terminal cell so they stay grab-able. */
export const NATIVE_PANE_HEADER_HEIGHT_PX = 28;
const NATIVE_PANE_HEADER_CELL_HEIGHT = 18;

export function resolveNativePaneHeaderRows(cellHeightPx = NATIVE_PANE_HEADER_CELL_HEIGHT): number {
  return NATIVE_PANE_HEADER_HEIGHT_PX / Math.max(1, cellHeightPx);
}

const NATIVE_PANE_BODY_LAYOUT_PROPS = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  minHeight: 0,
} as const;

export function shouldReservePaneFooter(nativePaneChrome: boolean | undefined, _showFooter: boolean): boolean {
  return !nativePaneChrome;
}

function resolvePaneBodyHeight({
  height,
  nativePaneChrome,
  footerVisible,
  reserveFooter = true,
  headerRows = PANE_HEADER_ROWS,
  footerRows = PANE_FOOTER_ROWS,
}: {
  height: number;
  nativePaneChrome?: boolean;
  footerVisible?: boolean;
  reserveFooter?: boolean;
  headerRows?: number;
  footerRows?: number;
}): number {
  const finiteHeight = Number.isFinite(height) ? height : 1;
  const normalizedHeight = nativePaneChrome ? finiteHeight : Math.max(1, Math.floor(finiteHeight));
  const resolvedFooterRows = Math.max(1, footerRows);
  const usedFooterRows = nativePaneChrome
    ? footerVisible ? PANE_FOOTER_ROWS : 0
    : reserveFooter ? resolvedFooterRows : 0;
  return Math.max(1, normalizedHeight - headerRows - usedFooterRows);
}

function getPaneBodyLayoutProps(nativePaneChrome: boolean | undefined, bodyHeight: number | undefined) {
  if (nativePaneChrome) return NATIVE_PANE_BODY_LAYOUT_PROPS;
  return {
    height: bodyHeight,
    flexGrow: bodyHeight == null ? 1 : 0,
    flexBasis: bodyHeight == null ? 0 : undefined,
  };
}

export function resolvePaneBodyFrame({
  width,
  height,
  nativePaneChrome,
  footerVisible,
  reserveFooter = true,
  headerRows = PANE_HEADER_ROWS,
  footerRows = PANE_FOOTER_ROWS,
}: {
  width?: number;
  height?: number;
  nativePaneChrome?: boolean;
  footerVisible?: boolean;
  reserveFooter?: boolean;
  headerRows?: number;
  footerRows?: number;
}) {
  const bodyHeight = typeof height === "number"
    ? resolvePaneBodyHeight({
      height,
      nativePaneChrome,
      footerVisible,
      reserveFooter,
      headerRows,
      footerRows,
    })
    : undefined;
  return {
    width: typeof width === "number" ? resolvePaneBodyWidth(width, nativePaneChrome) : undefined,
    height: bodyHeight,
    layoutProps: getPaneBodyLayoutProps(nativePaneChrome, bodyHeight),
  };
}

function resolvePaneBodyWidth(width: number, nativePaneChrome: boolean | undefined): number {
  const finiteWidth = Number.isFinite(width) ? width : 1;
  return nativePaneChrome ? Math.max(1, finiteWidth) : Math.max(1, Math.floor(finiteWidth));
}
