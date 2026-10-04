import type { DiceManager } from '../dice/dice-manager.js';

export interface Initiative {
  readonly id: string;
  readonly basicSpeed: number;
  readonly dx: number;
}

/** After this many consecutive tied roll-offs, stop rolling and keep the order given. */
const MAX_ROLL_OFFS = 20;

/**
 * The order combatants act in, fixed for the whole fight (Basic Set p.363):
 * highest Basic Speed first, ties to the higher DX, and any tie that remains is
 * broken by rolling 1d each, re-rolling among those still tied. A die source that
 * can never separate them (a constant one, say) ends in the order the fighters were given.
 */
export function turnOrder(fighters: readonly Initiative[], dice: DiceManager): string[] {
  const groups = new Map<string, Initiative[]>();
  for (const fighter of fighters) {
    const key = `${fighter.basicSpeed}/${fighter.dx}`;
    groups.set(key, [...(groups.get(key) ?? []), fighter]);
  }
  return [...groups.values()]
    .sort((a, b) => b[0]!.basicSpeed - a[0]!.basicSpeed || b[0]!.dx - a[0]!.dx)
    .flatMap((tied) => rollOff(tied.map((fighter) => fighter.id), dice, MAX_ROLL_OFFS));
}

function rollOff(ids: readonly string[], dice: DiceManager, rollsLeft: number): string[] {
  if (ids.length <= 1 || rollsLeft === 0) return [...ids];
  const rolled = ids.map((id) => ({ id, total: dice.roll('1d').total }));
  const byTotal = new Map<number, string[]>();
  for (const { id, total } of rolled) byTotal.set(total, [...(byTotal.get(total) ?? []), id]);
  return [...byTotal.entries()].sort(([a], [b]) => b - a).flatMap(([, tied]) => rollOff(tied, dice, rollsLeft - 1));
}
