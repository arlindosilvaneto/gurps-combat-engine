export interface DiceNotation {
  readonly count: number;
  readonly sides: number;
  /** Flat bonus or penalty added to the sum of the dice. */
  readonly modifier: number;
}

const NOTATION = /^(\d+)d(\d*)([+-]\d+)?$/i;

/**
 * Parses GURPS-style dice notation: "3d" and "3d6" are three six-sided dice,
 * "2d+1" and "1d-2" carry a flat modifier. Sides default to 6.
 */
export function parseNotation(notation: string): DiceNotation {
  const match = NOTATION.exec(notation.trim());
  if (!match) throw new RangeError(`Invalid dice notation: "${notation}"`);
  const [, countText, sidesText, modifierText] = match;
  const count = Number(countText);
  const sides = sidesText ? Number(sidesText) : 6;
  const modifier = modifierText ? Number(modifierText) : 0;
  if (count < 1) throw new RangeError(`Dice notation "${notation}" must roll at least one die`);
  if (sides < 2) throw new RangeError(`Dice notation "${notation}" needs dice with at least 2 sides`);
  return { count, sides, modifier };
}
