import { FONT_FAMILIES, getFontFamilyIds } from "../../../theme/font-family";
import { getThemeIds, themes } from "../../../theme/themes";
import { clampFontSize, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "../../../theme/font-scale";

export function cycleChoice(ids: readonly string[], current: string, delta: number): string {
  if (ids.length === 0) return current;
  const index = ids.indexOf(current);
  const from = index >= 0 ? index : 0;
  return ids[(from + delta + ids.length * Math.abs(delta)) % ids.length]!;
}

export function themeChoices(): Array<{ id: string; label: string; description: string }> {
  return getThemeIds().map((id) => ({
    id,
    label: themes[id]!.name,
    description: themes[id]!.description,
  }));
}

export function fontFamilyChoices(): Array<{ id: string; label: string; description: string }> {
  return getFontFamilyIds().map((id) => {
    const option = FONT_FAMILIES[id]!;
    return { id, label: option.name, description: option.description };
  });
}

export function nextFontSize(current: number, delta: number): number {
  return clampFontSize(clampFontSize(current) + delta);
}

export function fontSizeBoundsLabel(size: number): string {
  if (size <= MIN_FONT_SIZE_PX) return "min";
  if (size >= MAX_FONT_SIZE_PX) return "max";
  return "";
}
