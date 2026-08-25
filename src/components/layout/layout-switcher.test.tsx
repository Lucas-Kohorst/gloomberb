import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { UiHostProvider, type RendererHost, type UiHost } from "../../ui";
import { DialogHostProvider } from "../../ui/dialog";
import { AppContext, createInitialState } from "../../state/app/context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
import { LayoutSwitcherControl } from "./layout-switcher";

const rendererHost: RendererHost = {
  requestExit() {},
  async openExternal() {},
  async copyText() {},
  async readText() { return ""; },
  notify() {},
};

describe("LayoutSwitcherControl", () => {
  test("opens layout presets with Enter on the hosted Layouts control", () => {
    const buttons: Array<Record<string, unknown>> = [];
    const Box = ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => {
      if (props["data-gloom-role"] === "layout-presets-button") buttons.push(props);
      return <div>{children}</div>;
    };
    const Inline = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
    const ui = {
      capabilities: { nativePaneChrome: true },
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

    const config = createDefaultConfig("/tmp/gloomberb-layouts-enter");
    config.layouts = [{ name: "Home", layout: cloneLayout(config.layout) }];
    const state = createInitialState(config);
    const actions: Array<{ type: string; open?: boolean; query?: string }> = [];

    renderToStaticMarkup(
      <UiHostProvider ui={ui} renderer={rendererHost}>
        <DialogHostProvider
          dialog={{ alert: async () => {}, prompt: async () => undefined }}
          isOpen={false}
        >
          <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string; open?: boolean; query?: string }) }}>
            <LayoutSwitcherControl />
          </AppContext>
        </DialogHostProvider>
      </UiHostProvider>,
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.role).toBe("button");
    expect(buttons[0]?.tabIndex).toBe(0);

    const onKeyDown = buttons[0]?.onKeyDown as ((event: {
      key: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }) => void) | undefined;
    expect(onKeyDown).toBeTypeOf("function");
    onKeyDown?.({ key: "Enter", preventDefault() {}, stopPropagation() {} });

    expect(actions).toContainEqual({ type: "SET_COMMAND_BAR", open: true, query: "LAY " });
  });
});
