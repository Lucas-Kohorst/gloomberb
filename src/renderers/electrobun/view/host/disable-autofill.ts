const SKIP_INPUT_TYPES = new Set([
  "hidden",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "image",
  "range",
  "color",
]);

/**
 * Browser/OS autofill, password-manager pills (iCloud, 1Password, LastPass),
 * and suggestion UI stay off for every DOM field. Spread onto <input> / <textarea>.
 */
export const DISABLE_AUTOFILL_DOM_PROPS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoSave: "off",
  "aria-autocomplete": "none",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
  "data-bwignore": "true",
  "data-protonpass-ignore": "true",
  "data-gloom-nofill": "true",
} as const;

export const DISABLE_AUTOFILL_ATTRS: ReadonlyArray<readonly [string, string]> = [
  ["autocomplete", "off"],
  ["autocorrect", "off"],
  ["autocapitalize", "off"],
  ["spellcheck", "false"],
  ["autosave", "off"],
  ["aria-autocomplete", "none"],
  ["data-1p-ignore", "true"],
  ["data-lpignore", "true"],
  ["data-form-type", "other"],
  ["data-bwignore", "true"],
  ["data-protonpass-ignore", "true"],
  ["data-gloom-nofill", "true"],
];

type AttrElement = {
  tagName: string;
  type?: string;
  getAttribute?(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
};

function tagNameOf(node: { tagName?: string }): string {
  return String(node.tagName ?? "").toLowerCase();
}

export function isAutofillTarget(node: AttrElement | null | undefined): boolean {
  if (!node) return false;
  const tag = tagNameOf(node);
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  return !SKIP_INPUT_TYPES.has(String(node.type || "text").toLowerCase());
}

export function applyDisableAutofill(element: AttrElement | null | undefined): boolean {
  if (!element) return false;
  const tag = tagNameOf(element);
  if (tag === "form" || tag === "html") {
    if (element.getAttribute?.("autocomplete") !== "off") {
      element.setAttribute("autocomplete", "off");
    }
    return true;
  }
  if (!isAutofillTarget(element)) return false;
  if (
    element.getAttribute?.("data-gloom-nofill") === "true"
    && element.getAttribute?.("autocomplete") === "off"
    && element.getAttribute?.("spellcheck") === "false"
  ) {
    return true;
  }
  for (const [name, value] of DISABLE_AUTOFILL_ATTRS) {
    element.setAttribute(name, value);
  }
  element.removeAttribute?.("list");
  return true;
}

function visitTree(node: Node, apply: (element: AttrElement) => void): void {
  if (node.nodeType === 1) apply(node as unknown as AttrElement);
  const children = (node as ParentNode).querySelectorAll?.("input, textarea, form, html");
  if (!children) return;
  for (const child of children) apply(child as unknown as AttrElement);
}

let installedDocument: Document | null = null;
let installedObserver: MutationObserver | null = null;

/** Stamp every current and future input/textarea/form so raw DOM fields cannot opt into autofill. */
export function installDisableAutofillPolicy(doc: Document | null | undefined = typeof document === "undefined" ? null : document): () => void {
  if (!doc?.documentElement) return () => {};
  if (installedDocument === doc && installedObserver) {
    applyDisableAutofill(doc.documentElement as unknown as AttrElement);
    visitTree(doc.documentElement, applyDisableAutofill);
    return uninstallDisableAutofillPolicy;
  }
  uninstallDisableAutofillPolicy();
  installedDocument = doc;
  applyDisableAutofill(doc.documentElement as unknown as AttrElement);
  visitTree(doc.documentElement, applyDisableAutofill);

  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof Observer !== "function") return uninstallDisableAutofillPolicy;

  installedObserver = new Observer((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) visitTree(node, applyDisableAutofill);
      } else if (mutation.type === "attributes") {
        applyDisableAutofill(mutation.target as unknown as AttrElement);
      }
    }
  });
  installedObserver.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["autocomplete", "type", "list"],
  });
  return uninstallDisableAutofillPolicy;
}

export function uninstallDisableAutofillPolicy(): void {
  installedObserver?.disconnect();
  installedObserver = null;
  installedDocument = null;
}
