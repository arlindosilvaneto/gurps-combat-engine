import { parseNotation } from './notation.js';
import { randomSource, type DieSource } from './sources.js';
import { lookup, type ResultTable, type TableEntry } from './tables.js';

export interface DiceRoll {
  readonly notation: string;
  /** Each die's face, before the flat modifier. */
  readonly dice: readonly number[];
  readonly modifier: number;
  readonly total: number;
}

export interface TableRoll<T> {
  readonly roll: DiceRoll;
  readonly entry: TableEntry<T>;
}

export interface DiceManagerOptions {
  /** Defaults to real randomness. */
  readonly source?: DieSource;
}

/**
 * The single entry point for every random outcome in the engine. Inject it;
 * never reach for `Math.random` elsewhere. Swap the source to make a run
 * random, seeded, or fully scripted.
 */
export interface DiceManager {
  /** Rolls GURPS-style notation such as "3d", "2d+1" or "1d6-2". */
  roll(notation: string): DiceRoll;
  /** Rolls the table's own dice and returns the matching entry. */
  rollOnTable<T>(table: ResultTable<T>): TableRoll<T>;
  /** Every roll made through this manager, oldest first. */
  history(): readonly DiceRoll[];
}

export function createDiceManager({ source = randomSource() }: DiceManagerOptions = {}): DiceManager {
  const log: DiceRoll[] = [];

  function roll(notation: string): DiceRoll {
    const { count, sides, modifier } = parseNotation(notation);
    const dice = Array.from({ length: count }, () => source.nextInt(sides));
    const total = dice.reduce((sum, face) => sum + face, 0) + modifier;
    const result: DiceRoll = Object.freeze({ notation, dice: Object.freeze(dice), modifier, total });
    log.push(result);
    return result;
  }

  return {
    roll,
    rollOnTable(table) {
      const diceRoll = roll(table.dice);
      return { roll: diceRoll, entry: lookup(table, diceRoll.total) };
    },
    history: () => [...log],
  };
}
