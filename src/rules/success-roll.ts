import type { DiceManager, DiceRoll } from '../dice/dice-manager.js';
import type { ModifierSet } from '../modifiers/modifier-set.js';

export type RollOutcome = 'critical-success' | 'success' | 'failure' | 'critical-failure';

export interface RollClassification {
  readonly outcome: RollOutcome;
  /**
   * `effectiveSkill - total`: positive is the margin of success, negative the
   * margin of failure (Basic Set p.347). The forced outcomes (3-4 always succeed,
   * 17-18 always fail) can disagree in sign with the margin; trust `outcome`.
   */
  readonly margin: number;
}

/**
 * Classifies a 3d total against an effective skill (Basic Set p.347-348).
 *
 * Critical success: 3 or 4 always; 5 if skill is 15+; 6 if skill is 16+.
 * Critical failure: 18 always; 17 if skill is 15 or less; any roll 10 or more
 * above skill. Otherwise a roll succeeds when it is no higher than skill, except
 * that 17 and 18 never do (p.347 "otherwise, it is an ordinary failure").
 *
 * A 3 or 4 is checked first, so it stays a critical success even on a skill so
 * low (-6 or worse) that it is also 10 above the skill.
 */
export function classifyRoll(total: number, effectiveSkill: number): RollClassification {
  return { outcome: outcomeOf(total, effectiveSkill), margin: effectiveSkill - total };
}

function outcomeOf(total: number, skill: number): RollOutcome {
  if (total <= 4) return 'critical-success';
  if (total === 5 && skill >= 15) return 'critical-success';
  if (total === 6 && skill >= 16) return 'critical-success';

  if (total >= 18) return 'critical-failure';
  if (total === 17) return skill <= 15 ? 'critical-failure' : 'failure';
  if (total >= skill + 10) return 'critical-failure';

  return total <= skill ? 'success' : 'failure';
}

export interface SuccessRollOptions {
  /** The trait level being rolled against, before modifiers. */
  readonly skill: number;
  /** Active modifiers; those matching `tags` (and global ones) adjust the skill. */
  readonly modifiers?: ModifierSet;
  /** What this roll is, e.g. `['attack']`, used to select modifiers. */
  readonly tags?: readonly string[];
}

export interface SuccessRollResult extends RollClassification {
  readonly roll: DiceRoll;
  readonly baseSkill: number;
  /** Sum of the modifiers that applied to this roll. */
  readonly modifier: number;
  /** `baseSkill + modifier`: what the roll was made against. */
  readonly effectiveSkill: number;
  readonly success: boolean;
  readonly critical: boolean;
}

/** Rolls 3d against a skill adjusted by the active modifiers. */
export function rollSuccess(dice: DiceManager, { skill, modifiers, tags = [] }: SuccessRollOptions): SuccessRollResult {
  const modifier = modifiers?.total(tags) ?? 0;
  const effectiveSkill = skill + modifier;
  const roll = dice.roll('3d');
  const { outcome, margin } = classifyRoll(roll.total, effectiveSkill);
  return Object.freeze({
    roll,
    baseSkill: skill,
    modifier,
    effectiveSkill,
    outcome,
    margin,
    success: outcome === 'success' || outcome === 'critical-success',
    critical: outcome === 'critical-success' || outcome === 'critical-failure',
  });
}
