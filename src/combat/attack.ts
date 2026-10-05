import type { DiceManager } from '../dice/dice-manager.js';
import { rollDamage, resolveInjury, type InjuryResult } from '../rules/damage.js';
import { rollSuccess, type SuccessRollResult } from '../rules/success-roll.js';
import type { AttackOption, Combatant } from './combatant.js';
import { MANEUVER_EFFECTS, type Maneuver } from './maneuvers.js';
import { ROLL_TAGS, type DamageOutcome, type FighterState } from './types.js';

/**
 * The attack roll (Basic Set p.369): skill plus the attacker's modifiers, its maneuver's
 * bonus, and any shock from injuries since its last turn (p.419: melee skills are DX-based).
 * A roll that succeeds hits unless the target defends; 3-4 always hits and is a critical
 * hit, 17-18 always misses (classifyRoll covers both).
 */
export function rollAttack(dice: DiceManager, attackerState: FighterState, maneuver: Maneuver, attack: AttackOption): SuccessRollResult {
  let modifiers = attackerState.modifiers;
  const bonus = MANEUVER_EFFECTS[maneuver].attackBonus;
  if (bonus !== 0) modifiers = modifiers.add({ label: maneuver, value: bonus, appliesTo: [ROLL_TAGS.attack] }).set;
  const { shock } = attackerState.conditions;
  if (shock > 0) modifiers = modifiers.add({ label: 'Shock', value: -shock, appliesTo: [ROLL_TAGS.attack] }).set;
  return rollSuccess(dice, { skill: attack.skill, modifiers, tags: [ROLL_TAGS.attack] });
}

/**
 * A hit's damage (Basic Set pp.378-379): roll, subtract DR, apply the wounding modifier.
 * Every hit lands on the torso for now. An unarmed hit on DR 3+ also costs the attacker
 * 1 crushing damage per 5 basic damage, up to the target's DR ("Hurting Yourself", p.379);
 * the attacker's own DR on the striking limb isn't modelled.
 */
export function rollHit(
  dice: DiceManager,
  attack: AttackOption,
  target: Combatant,
): { damage: DamageOutcome; selfInjury: InjuryResult | null } {
  const { roll, basic } = rollDamage(dice, attack.damage.notation, attack.damage.type);
  const injury = resolveInjury({ basic, dr: target.dr, type: attack.damage.type });
  const selfInjury =
    attack.unarmed && target.dr >= 3 ? resolveInjury({ basic: Math.min(Math.floor(basic / 5), target.dr), dr: 0, type: 'cr' }) : null;
  return { damage: { roll, type: attack.damage.type, injury }, selfInjury };
}
