import { expect, test } from "bun:test";
import { act, useMemo, useState, type ReactNode } from "react";
import { UiHostProvider, useRendererHost, useUiHost } from "../../../../ui";
import { createDomTestHarness } from "../../../../renderers/dom/test-utils";
import { WebIcon, WebIconButton } from "../../../../renderers/dom/desktop/icons";
import { PaneFooterBar, PaneFooterProvider, usePaneFooter, type PaneFooterSegment } from "./index";

const { render } = createDomTestHarness();

function DesktopChrome({ children }: { children: ReactNode }) {
  const base = useUiHost();
  const renderer = useRendererHost();
  const ui = useMemo(() => ({ ...base, Icon: WebIcon, IconButton: WebIconButton, capabilities: { ...base.capabilities, nativePaneChrome: true } }), [base]);
  return <UiHostProvider ui={ui} renderer={renderer}>{children}</UiHostProvider>;
}

function press(element: Element) {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

test("footer warning is the word warning, with no icon, and keeps the current disclosure target", async () => {
  let update!: (value: Partial<PaneFooterSegment>) => void;
  let selection!: (value: string) => void;
  const actions: string[] = [];
  function Registration() {
    const [selected, setSelected] = useState("AMD");
    const [segment, setSegment] = useState<PaneFooterSegment>({
      id: "notice", label: "Data warnings", title: "Data warnings (!)", shortcut: "!",
      parts: [{ text: "warning", tone: "warning" }],
    });
    update = (value) => setSegment((current) => ({ ...current, ...value }));
    selection = setSelected;
    usePaneFooter("notice", () => ({ info: [{ ...segment, onPress: () => actions.push(selected) }] }), [segment, selected]);
    return null;
  }
  const container = await render(<DesktopChrome><div onClick={() => actions.push("parent")}>
    <PaneFooterProvider>{(footer) => <><Registration /><PaneFooterBar footer={footer} focused width={50} /></>}</PaneFooterProvider>
  </div></DesktopChrome>);
  const notice = () => container.querySelector('[aria-label="Data warnings"], [aria-label="History warnings"]')!;
  expect(container.querySelector("svg")).toBeNull();
  expect(notice().textContent).toContain("warning");
  expect(notice().getAttribute("title")).toBe("Data warnings (!)");
  await act(async () => { press(notice()); selection("MSFT"); });
  await act(async () => { update({ label: "History warnings", title: "History warnings (!)" }); });
  expect(actions).toEqual(["AMD"]);
  expect(notice().getAttribute("aria-label")).toBe("History warnings");
  expect(notice().getAttribute("title")).toBe("History warnings (!)");
  await act(async () => { press(notice()); });
  expect(actions).toEqual(["AMD", "MSFT"]);
  await act(async () => { update({ disabled: true }); });
  await act(async () => { press(notice()); });
  expect(actions).toEqual(["AMD", "MSFT"]);
});
