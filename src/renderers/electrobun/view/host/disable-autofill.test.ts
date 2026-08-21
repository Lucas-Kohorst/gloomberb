import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
const globals: Record<string, unknown> = {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  MutationObserver: testWindow.MutationObserver,
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

import { afterEach, describe, expect, test } from "bun:test";
import {
  DISABLE_AUTOFILL_ATTRS,
  DISABLE_AUTOFILL_DOM_PROPS,
  applyDisableAutofill,
  installDisableAutofillPolicy,
  isAutofillTarget,
  uninstallDisableAutofillPolicy,
} from "./disable-autofill";

function expectNoFill(element: { getAttribute(name: string): string | null }) {
  for (const [name, value] of DISABLE_AUTOFILL_ATTRS) {
    expect(element.getAttribute(name)).toBe(value);
  }
}

describe("disable autofill policy", () => {
  afterEach(() => {
    uninstallDisableAutofillPolicy();
    testWindow.document.body.innerHTML = "";
    testWindow.document.documentElement.removeAttribute("autocomplete");
  });

  test("defaults autocomplete, autocorrect, and password-manager suppressors", () => {
    expect(DISABLE_AUTOFILL_DOM_PROPS.autoComplete).toBe("off");
    expect(DISABLE_AUTOFILL_DOM_PROPS.autoCorrect).toBe("off");
    expect(DISABLE_AUTOFILL_DOM_PROPS.autoCapitalize).toBe("off");
    expect(DISABLE_AUTOFILL_DOM_PROPS.spellCheck).toBe(false);
    expect(DISABLE_AUTOFILL_DOM_PROPS["data-1p-ignore"]).toBe("true");
    expect(DISABLE_AUTOFILL_DOM_PROPS["data-lpignore"]).toBe("true");
    expect(DISABLE_AUTOFILL_DOM_PROPS["data-form-type"]).toBe("other");
  });

  test("stamps text inputs and textareas, and skips checkboxes", () => {
    const input = testWindow.document.createElement("input");
    const search = testWindow.document.createElement("input");
    search.setAttribute("type", "search");
    const password = testWindow.document.createElement("input");
    password.setAttribute("type", "password");
    const area = testWindow.document.createElement("textarea");
    const checkbox = testWindow.document.createElement("input");
    checkbox.setAttribute("type", "checkbox");

    expect(isAutofillTarget(input as unknown as HTMLInputElement)).toBe(true);
    expect(isAutofillTarget(search as unknown as HTMLInputElement)).toBe(true);
    expect(isAutofillTarget(password as unknown as HTMLInputElement)).toBe(true);
    expect(isAutofillTarget(area as unknown as HTMLTextAreaElement)).toBe(true);
    expect(isAutofillTarget(checkbox as unknown as HTMLInputElement)).toBe(false);

    applyDisableAutofill(input as unknown as HTMLInputElement);
    applyDisableAutofill(area as unknown as HTMLTextAreaElement);
    applyDisableAutofill(checkbox as unknown as HTMLInputElement);
    expectNoFill(input);
    expectNoFill(area);
    expect(checkbox.getAttribute("data-gloom-nofill")).toBeNull();
  });

  test("installs on the document and catches fields added later", async () => {
    installDisableAutofillPolicy(testWindow.document);
    expect(testWindow.document.documentElement.getAttribute("autocomplete")).toBe("off");

    const late = testWindow.document.createElement("textarea");
    late.setAttribute("placeholder", "Type a message...");
    testWindow.document.body.appendChild(late);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expectNoFill(late);
  });
});
