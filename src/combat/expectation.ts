import { parseNotation } from '../dice/notation.js';
import { resolveInjury, type WoundingType } from '../rules/damage.js';
import { classifyRoll } from '../rules/success-roll.js';

/** Probability of each total on a distribution: `[total, probability]`. */
type Distribution = ReadonlyArray<readonly [number, number]>;

/** The exact distribution of `count` dice with `sides` faces each, by dynamic programming. */
export function diceDistribution(count: number, sides: number): Distribution {
  let ways = new Map<number, number>([[0, 1]]);
  for (let die = 0; die < count; die += 1) {
    const next = new Map<number, number>();
    for (const [total, n] of ways) {
      for (let face = 1; face <= sides; face += 1) next.set(total + face, (next.get(total + face) ?? 0) + n);
    }
    ways = next;
  }
  const all = sides ** count;
  return [...ways.entries()].sort(([a], [b]) => a - b).map(([total, n]) => [total, n / all] as const);
}

const THREE_D = diceDistribution(3, 6);

/** Chance a 3d success roll against `skill` succeeds, criticals included (3-4 always; 17-18 never). */
export function successChance(skill: number): number {
  return THREE_D.reduce((sum, [total, p]) => (isSuccess(total, skill) ? sum + p : sum), 0);
}

function isSuccess(total: number, skill: number): boolean {
  const { outcome } = classifyRoll(total, skill);
  return outcome === 'success' || outcome === 'critical-success';
}

export interface ExpectedInjuryInput {
  /** The attack skill, with modifiers already applied. */
  readonly skill: number;
  readonly damage: { readonly notation: string; readonly type: WoundingType };
  readonly targetDr: number;
  /** The target's Dodge with modifiers applied, or null if it can't defend. */
  readonly dodge: number | null;
}

/**
 * The average HP an attack takes off its target: the chance to hit, times the chance
 * the target fails to dodge (a critical hit can't be dodged), times the average injury
 * after DR and the wounding modifier. Computed exactly from the dice, not approximated.
 * It ignores what the attacker risks in return (Hurting Yourself).
 */
export function expectedInjury({ skill, damage, targetDr, dodge }: ExpectedInjuryInput): number {
  const { count, sides, modifier } = parseNotation(damage.notation);
  const floor = damage.type === 'cr' ? 0 : 1;
  const perHit = diceDistribution(count, sides).reduce(
    (sum, [total, p]) => sum + p * resolveInjury({ basic: Math.max(total + modifier, floor), dr: targetDr, type: damage.type }).injury,
    0,
  );

  const dodged = dodge === null ? 0 : successChance(dodge);
  const landed = THREE_D.reduce((sum, [total, p]) => {
    const { outcome } = classifyRoll(total, skill);
    if (outcome === 'critical-success') return sum + p;
    return outcome === 'success' ? sum + p * (1 - dodged) : sum;
  }, 0);
  return landed * perHit;
}
