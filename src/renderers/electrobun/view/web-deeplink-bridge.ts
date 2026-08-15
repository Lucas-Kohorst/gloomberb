import type { DesktopDeepLinkBridge } from "../../../types/desktop-deeplink";

function currentDeepLink(): string | null {
  const queryValue = new URLSearchParams(window.location.search).get("gloomberb");
  if (queryValue?.startsWith("gloomberb:")) return queryValue;
  const hashValue = window.location.hash.slice(1);
  return hashValue.startsWith("gloomberb:") ? hashValue : null;
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
