/** @jsxImportSource react */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogHostProvider, type DialogApi } from "../../../ui/dialog";
import { inertOutside, modalSiblingKeepList } from "../../../ui/inert";
import { blendHex } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";

interface DialogState {
  id: string;
  content: ReactNode | ((context: { dialogId: string; dismiss(): void; resolve(value: unknown): void }) => ReactNode);
  closeOnClickOutside: boolean;
  returnFocus: HTMLElement | null;
  resolve(value: unknown): void;
}

let nextDialogId = 1;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function isDialogDismissKey(event: Pick<KeyboardEvent, "key" | "isComposing">): boolean {
  return !event.isComposing && (event.key === "Escape" || event.key === "Esc");
}

export function shouldFocusDialogContainer(
  dialog: Pick<HTMLElement, "contains">,
  activeElement: Element | null,
): boolean {
  return activeElement === null || !dialog.contains(activeElement);
}

export function WebDialogHostProvider({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const dialogStateRef = useRef<DialogState | null>(null);
  const dialogElementRef = useRef<HTMLDivElement | null>(null);
  const backdropElementRef = useRef<HTMLDivElement | null>(null);
  const restoreInertRef = useRef<(() => void) | null>(null);
  const dialogBorder = blendHex(colors.border, colors.borderFocused, 0.18);
  const dialogBg = blendHex(colors.panel, colors.bg, 0.12);

  const close = useCallback((value?: unknown) => {
    const current = dialogStateRef.current;
    if (!current) return;
    dialogStateRef.current = null;
    // Lift inert now, not on the next commit: the focus restore below runs
    // first and cannot land on an element that is still inert.
    restoreInertRef.current?.();
    restoreInertRef.current = null;
    setDialogState(null);
    current.resolve(value);
    queueMicrotask(() => {
      if (current.returnFocus?.isConnected) {
        current.returnFocus.focus({ preventScroll: true });
      }
    });
  }, []);

  const open = useCallback(function openDialog<T>(options: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve) => {
      const activeElement = document.activeElement;
      const next: DialogState = {
        id: `web-dialog-${nextDialogId++}`,
        content: options.content as DialogState["content"],
        closeOnClickOutside: options.closeOnClickOutside === true,
        returnFocus: activeElement instanceof HTMLElement ? activeElement : null,
        resolve: (value) => resolve(value as T),
      };
      dialogStateRef.current?.resolve(undefined);
      dialogStateRef.current = next;
      setDialogState(next);
    });
  }, []);

  // aria-modal alone only asks assistive technology to ignore the workspace;
  // inert actually removes it from the tab order, pointer, and the a11y tree.
  useLayoutEffect(() => {
    if (!dialogState) return;
    const backdrop = backdropElementRef.current;
    const root = backdrop?.parentElement;
    if (!backdrop || !root) return;
    const restore = inertOutside(root, [backdrop, ...modalSiblingKeepList(root)]);
    restoreInertRef.current = restore;
    return () => {
      restore();
      if (restoreInertRef.current === restore) restoreInertRef.current = null;
    };
  }, [dialogState?.id]);

  useEffect(() => {
    if (!dialogState) return;
    const frame = requestAnimationFrame(() => {
      const dialogElement = dialogElementRef.current;
      if (
        dialogElement
        && shouldFocusDialogContainer(dialogElement, document.activeElement)
      ) {
        dialogElement.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [dialogState?.id]);

  useEffect(() => {
    if (!dialogState) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (!isDialogDismissKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      close(undefined);
    };
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => window.removeEventListener("keydown", dismissOnEscape, true);
  }, [close, dialogState?.id]);

  // aria-modal="true" tells assistive technology focus is confined to the
  // dialog. Without a trap, Tab walks out to the workspace behind the backdrop,
  // which is reachable because dialogs render real inputs and buttons.
  useEffect(() => {
    if (!dialogState) return;
    const dialogElement = dialogElementRef.current;
    if (!dialogElement) return;
    const confineTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialogElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) {
        // Nothing to tab between, so keep focus on the container.
        event.preventDefault();
        dialogElement.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === dialogElement)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && (active === first || active === dialogElement)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    };
    dialogElement.addEventListener("keydown", confineTab);
    return () => dialogElement.removeEventListener("keydown", confineTab);
  }, [dialogState?.id]);

  const api = useMemo<DialogApi>(() => ({
    alert: open,
    prompt: open,
  }), [open]);

  return (
    <DialogHostProvider
      dialog={api}
      isOpen={dialogState !== null}
      dismiss={dialogState ? () => close(undefined) : undefined}
    >
      {children}
      {dialogState && (
        <div
          ref={backdropElementRef}
          className="gloom-dialog-backdrop"
          onMouseDown={(event) => {
            if (
              dialogState.closeOnClickOutside
              && event.target === event.currentTarget
            ) {
              close(undefined);
            }
          }}
        >
          <div
            ref={dialogElementRef}
            role="dialog"
            aria-modal="true"
            aria-label="Dialog"
            tabIndex={-1}
            className="gloom-dialog"
            style={{
              borderColor: dialogBorder,
              background: dialogBg,
              color: colors.text,
            }}
          >
            {typeof dialogState.content === "function"
              ? dialogState.content({
                dialogId: dialogState.id,
                dismiss: () => close(undefined),
                resolve: close,
              })
              : dialogState.content}
          </div>
        </div>
      )}
    </DialogHostProvider>
  );
}
