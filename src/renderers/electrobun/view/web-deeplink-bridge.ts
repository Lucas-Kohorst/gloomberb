import type { DesktopDeepLinkBridge } from "../../../types/desktop-deeplink";

function currentDeepLink(): string | null {
  const queryValue = new URLSearchParams(window.location.search).get("gloomberb");
  if (queryValue?.startsWith("gloomberb:")) return queryValue;
  const hashValue = window.location.hash.slice(1);
  if (hashValue.startsWith("gloomberb:")) return hashValue;

  // Detect the public /article share path and convert it to an internal
  // gloomberb:// deep link so the existing resolver handles it uniformly.
  if (window.location.pathname === "/article") {
    const payload = new URLSearchParams(window.location.search).get("a");
    if (payload) {
      return `gloomberb://article?a=${encodeURIComponent(payload)}`;
    }
  }

  return null;
}

export function createWebDeepLinkBridge(): DesktopDeepLinkBridge {
  return {
    subscribe(listener) {
      const emit = () => {
        const url = currentDeepLink();
        if (url) listener({ url });
      };
      emit();
      window.addEventListener("hashchange", emit);
      return () => window.removeEventListener("hashchange", emit);
    },
  };
}
