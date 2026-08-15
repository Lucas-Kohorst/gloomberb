import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { UiHostProvider } from "../ui";
import type { RendererHost, UiHost } from "../ui/host";
import { TableViewFrame } from "./table-view-shared";

const rendererHost: RendererHost = {
  requestExit() {},
  async openExternal() {},
  async copyText() {},
  async readText() { return ""; },
  notify() {},
};

function renderFrame(nativePaneChrome: boolean) {
  const frames: Array<Record<string, unknown>> = [];
  const Box = ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => {
    if (props["data-gloom-role"] === "table-view-frame") frames.push(props);
    return <div>{children}</div>;
  };
  const Inline = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  const ui = {
    capabilities: { nativePaneChrome },
    Box,
    Text: Inline,
    Span: Inline,
    Strong: Inline,
    Underline: Inline,
    ScrollBox: Box,
    Input: Box,
    Textarea: Box,
    ChartSurface: Box,
    ImageSurface: Box,
    SpinnerMark: Inline,
    AsciiText: Inline,
  } as unknown as UiHost;

  renderToStaticMarkup(
    <UiHostProvider ui={ui} renderer={rendererHost}>
      <TableViewFrame width={72} height={18}>
        <span>rows</span>
      </TableViewFrame>
    </UiHostProvider>,
  );
  return frames[0] ?? {};
}

describe("TableViewFrame", () => {
  test("pins cell size in the terminal and stretches on web", () => {
    const terminal = renderFrame(false);
    const web = renderFrame(true);

    expect(terminal.width).toBe(72);
    expect(terminal.height).toBe(18);
    expect(web.width).toBe("100%");
    expect(web.maxWidth).toBe("100%");
    expect(web.height).toBeUndefined();
  });
});
