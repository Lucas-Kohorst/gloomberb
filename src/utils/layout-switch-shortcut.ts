export function layoutSwitchUsesOption(host: {
  kind?: "opentui" | "desktop-web";
  nativePaneChrome?: boolean;
}): boolean {
  return host.kind === "desktop-web" || host.nativePaneChrome === true;
}

export function formatLayoutSwitchShortcutHint(slot: number, usesOption: boolean): string {
  return usesOption ? `OPT ${slot}` : `^${slot}`;
}

function isLayoutSwitchDigit(name: string | undefined): boolean {
  return /^[1-9]$/.test(name ?? "");
}

function hasPrimaryCommandModifier(event: {
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
}): boolean {
  return !!(event.ctrl || event.meta || event.super);
}

function hasOptionModifier(event: {
  alt?: boolean;
  option?: boolean;
}): boolean {
  return !!(event.alt || event.option);
}

export function isLayoutSwitchShortcut(
  event: {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    super?: boolean;
    alt?: boolean;
    option?: boolean;
  },
  usesOption: boolean,
): boolean {
  if (!isLayoutSwitchDigit(event.name)) return false;
  if (usesOption) return hasOptionModifier(event) && !hasPrimaryCommandModifier(event);
  return hasPrimaryCommandModifier(event);
}
