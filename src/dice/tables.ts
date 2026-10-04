import { parseNotation } from './notation.js';

/** Inclusive range of roll totals mapped to one result. */
export interface TableEntry<T> {
  readonly min: number;
  readonly max: number;
  readonly result: T;
}

/**
 * Maps the total of a dice roll to a result (hit location, critical effect,
 * ...). Entries cover every possible total exactly once.
 */
export interface ResultTable<T> {
  readonly name: string;
  readonly dice: string;
  /** Sorted by `min`. */
  readonly entries: readonly TableEntry<T>[];
}

export interface TableSpec<T> {
  readonly name: string;
  readonly dice: string;
  readonly entries: readonly TableEntry<T>[];
}

/** Builds a table, throwing if the entries leave a gap, overlap, or miss part of the dice range. */
export function createTable<T>({ name, dice, entries }: TableSpec<T>): ResultTable<T> {
  const { count, sides, modifier } = parseNotation(dice);
  const lowest = count + modifier;
  const highest = count * sides + modifier;
  const sorted = [...entries].sort((a, b) => a.min - b.min);

  let expected = lowest;
  for (const entry of sorted) {
    if (entry.min > entry.max) {
      throw new RangeError(`Table "${name}": entry ${entry.min}-${entry.max} is inverted`);
    }
    if (entry.min !== expected) {
      throw new RangeError(
        `Table "${name}": expected an entry starting at ${expected} but found ${entry.min} (gap or overlap)`,
      );
    }
    expected = entry.max + 1;
  }
  if (expected !== highest + 1) {
    throw new RangeError(`Table "${name}": entries must cover ${lowest}-${highest} (${dice}), ended at ${expected - 1}`);
  }

  return Object.freeze({ name, dice, entries: Object.freeze(sorted.map((entry) => Object.freeze({ ...entry }))) });
}

/** The entry covering `total`. Throws for a total outside the table's dice range. */
export function lookup<T>(table: ResultTable<T>, total: number): TableEntry<T> {
  const entry = table.entries.find((candidate) => total >= candidate.min && total <= candidate.max);
  if (!entry) throw new RangeError(`Table "${table.name}": no entry for ${total}`);
  return entry;
}
