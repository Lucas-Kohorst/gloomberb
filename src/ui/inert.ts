/**
 * Makes everything under `root` inert except the `keep` elements and the path
 * down to them, the way a native modal `<dialog>` does. Returns a restore
 * function that only clears the marks it set, so nested modals unwind cleanly.
 */
export function inertOutside(root: Element, keep: readonly Element[]): () => void {
  const marked: Element[] = [];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (keep.includes(child)) continue;
      if (keep.some((element) => child.contains(element))) {
        visit(child);
        continue;
      }
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      marked.push(child);
    }
  };
  visit(root);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const element of marked) element.removeAttribute("inert");
  };
}

/**
 * Surfaces that stay live above a modal: toasts are stacked over the dialog
 * backdrop on purpose so their actions remain clickable and announced.
 */
export function modalSiblingKeepList(root: Element): Element[] {
  return Array.from(root.querySelectorAll(".gloom-toast-viewport"));
}
