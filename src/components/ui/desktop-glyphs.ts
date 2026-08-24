/** Stroke chevrons for hosted/desktop chrome. Do not use "←" / "v" as UI arrows. */

export type DesktopChevronDirection = "left" | "down";

function chevronPath(direction: DesktopChevronDirection): string {
  return direction === "left"
    ? "M10.25 3.5 5.75 8l4.5 4.5"
    : "M3.5 6.25 8 10.75l4.5-4.5";
}

export function desktopChevronDataUri(
  direction: DesktopChevronDirection,
  color: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${chevronPath(direction)}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const desktopChevronBoxStyle = (
  direction: DesktopChevronDirection,
  color: string,
  size = 12,
): Record<string, string | number> => ({
  width: size,
  height: size,
  flexShrink: 0,
  backgroundImage: desktopChevronDataUri(direction, color),
  backgroundRepeat: "no-repeat",
  backgroundPosition: "center",
  backgroundSize: `${size}px ${size}px`,
});
