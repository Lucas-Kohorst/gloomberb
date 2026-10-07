export function handleChartCommandBarKey(event: KeyboardEvent, openCommandBar: () => void): void {
  if (event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) openCommandBar();
}

export function bindChartCommandBarKey(container: HTMLElement, openCommandBar: () => void): () => void {
  const frames = new Map<HTMLIFrameElement, () => void>();
  const handler = (event: KeyboardEvent) => handleChartCommandBarKey(event, openCommandBar);
  const scan = () => {
    for (const [frame, dispose] of frames) {
      if (!container.contains(frame)) { dispose(); frames.delete(frame); }
    }
    for (const frame of container.querySelectorAll("iframe")) {
      if (frames.has(frame)) continue;
      let detach = () => {};
      const attach = () => {
        detach();
        try {
          const frameWindow = frame.contentWindow;
          if (!frameWindow || !frame.contentDocument) return;
          frameWindow.addEventListener("keydown", handler, true);
          detach = () => frameWindow.removeEventListener("keydown", handler, true);
        } catch {
          // Only the locally hosted library is accessible; never inspect a remote frame.
        }
      };
      frame.addEventListener("load", attach);
      attach();
      frames.set(frame, () => {
        frame.removeEventListener("load", attach);
        detach();
      });
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(container, { childList: true, subtree: true });
  scan();
  return () => {
    observer.disconnect();
    for (const dispose of frames.values()) dispose();
    frames.clear();
  };
}
