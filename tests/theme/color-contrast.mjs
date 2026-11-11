// Measure the rendered color independently from the production cascade algorithm.
import Color from 'color';

export function themeColorContrastRatio(first, second) {
  return Color(first).contrast(Color(second));
}
