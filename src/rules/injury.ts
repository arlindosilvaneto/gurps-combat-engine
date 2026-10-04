import type { SuccessRollResult } from './success-roll.js';

/**
 * The shock penalty from one injury (Basic Set pp.380, 419): -1 per HP lost, or for a
 * fighter with 20+ HP, -1 per HP/10 lost (dropping fractions: 20-29 HP is -1 per 2 HP).
 * Returned as a positive number of points; never more than 4. Shock affects DX- and IQ-based
 * rolls on the victim's next turn only, and never active defenses (p.374).
 */
export function shockPenalty(injury: number, maxHp: number): number {
  if (injury <= 0) return 0;
  const perPoint = maxHp >= 20 ? Math.floor(maxHp / 10) : 1;
  return Math.min(4, Math.floor(injury / perPoint));
}

/** The most shock a fighter can carry at once, whatever its injuries (p.419). */
export const MAX_SHOCK = 4;

/** A single injury of more than half the victim's HP (p.420). */
export function isMajorWound(injury: number, maxHp: number): boolean {
  return injury > maxHp / 2;
}

export type KnockdownOutcome = 'none' | 'stunned' | 'unconscious';

/**
 * The result of the HT roll a major wound calls for (p.420): success, no effect beyond shock;
 * failure, stunned (and knocked down); failure by 5 or more, or any critical failure, unconscious.
 */
export function knockdownOutcome(roll: SuccessRollResult): KnockdownOutcome {
  if (roll.success) return 'none';
  if (roll.outcome === 'critical-failure' || roll.margin <= -5) return 'unconscious';
  return 'stunned';
}
