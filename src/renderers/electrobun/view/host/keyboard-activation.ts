/**
 * Keyboard parity for boxes that only speak mouse. A box marked
 * `data-gloom-interactive` with a press handler is a button to a pointer user,
 * so it becomes one for assistive technology and the keyboard too: it takes a
 * button role, a tab stop, and Enter/Space replay the press as real mouse
 * events so every existing handler (and every ancestor's) runs unchanged.
 */

type InteractiveProps = Record<string, unknown>;

export function isKeyboardActivatableBox(props: InteractiveProps): boolean {
  const interactive = props["data-gloom-interactive"];
  if (interactive !== "true" && interactive !== true) return false;
  if (props.role != null) return false;
  // Drag surfaces (resize handles, dividers) have no meaningful "press".
  if (
    typeof props.onMouse === "function"
    || typeof props.onMouseDrag === "function"
    || typeof props.onMouseDragEnd === "function"
  ) {
    return false;
  }
  return typeof props.onMouseDown === "function"
    || typeof props.onMouseUp === "function"
    || typeof props.onClick === "function";
}

export function isActivationKey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "isComposing">): boolean {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

let lastInteraction: "pointer" | "keyboard" = "keyboard";
const trackedDocuments = new WeakSet<Document>();

/**
 * Tracks whether the most recent input was a pointer press, so a box that took
 * focus from a click does not then claim Enter/Space. Before these boxes were
 * focusable, a click left focus on the body and Enter went to the app's own
 * shortcuts (open the selected row, submit the form); that must keep working.
 */
export function installFocusModalityTracking(doc: Document): void {
  if (trackedDocuments.has(doc)) return;
  trackedDocuments.add(doc);
  const markPointer = () => {
    lastInteraction = "pointer";
  };
  doc.addEventListener("mousedown", markPointer, true);
  doc.addEventListener("pointerdown", markPointer, true);
  doc.addEventListener("keydown", () => {
    lastInteraction = "keyboard";
  }, true);
}

export function lastInteractionWasPointer(): boolean {
  return lastInteraction === "pointer";
}

/**
 * Replays a primary-button click at the element's centre. Untrusted events
 * carry no default action, so focus stays where the keyboard put it.
 */
export function activateWithPointerEvents(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    detail: 1,
  };
  const view = element.ownerDocument.defaultView;
  const MouseEventCtor = (view as unknown as { MouseEvent?: typeof MouseEvent } | null)?.MouseEvent ?? MouseEvent;
  try {
    element.dispatchEvent(new MouseEventCtor("mousedown", { ...init, buttons: 1 }));
    if (!element.isConnected) return;
    element.dispatchEvent(new MouseEventCtor("mouseup", { ...init, buttons: 0 }));
    if (!element.isConnected) return;
    element.dispatchEvent(new MouseEventCtor("click", { ...init, buttons: 0 }));
  } finally {
    // The replayed mousedown is still a keyboard interaction; focus the press
    // moves somewhere else must keep answering Enter/Space.
    lastInteraction = "keyboard";
  }
}
