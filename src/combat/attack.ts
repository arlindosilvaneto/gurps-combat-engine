import type { DiceManager } from '../dice/dice-manager.js';
import { rollDamage, resolveInjury } from '../rules/damage.js';
import { rollSuccess } from '../rules/success-roll.js';
import type { AttackOption, Combatant } from './combatant.js';
import { MANEUVER_EFFECTS, type Maneuver } from './maneuvers.js';
import { ROLL_TAGS, type AttackResult, type FighterState } from './types.js';

export interface AttackParams {
  readonly dice: DiceManager;
  readonly attackerState: FighterState;
  readonly maneuver: Maneuver;
  readonly attack: AttackOption;
  readonly target: Combatant;
  readonly targetState: FighterState;
}

/**
 * Resolves one melee attack in the three rolls the Basic Set describes (p.369):
 * the attack roll, the target's defense roll, then damage.
 *
 * Simplifications for now: Dodge is the only active defense; a critical hit just
 * can't be defended against (the Critical Hit Table, p.556, isn't applied); every
 * hit lands on the torso, so the attacker's DR on the striking limb isn't modelled
 * either (the self-injury from punching armor ignores it).
 */
export function resolveAttack({
  dice,
  attackerState,
  maneuver,
  attack,
  target,
  targetState,
}: AttackParams): AttackResult {
  const attackBonus = MANEUVER_EFFECTS[maneuver].attackBonus;
  const attackModifiers =
    attackBonus === 0
      ? attackerState.modifiers
      : attackerState.modifiers.add({ label: maneuver, value: attackBonus, appliesTo: [ROLL_TAGS.attack] }).set;
  const attackRoll = rollSuccess(dice, { skill: attack.skill, modifiers: attackModifiers, tags: [ROLL_TAGS.attack] });
  const base = { targetId: target.id, attackId: attack.id, attackRoll };

  // p.369: a roll that beats the skill is a hit; 3-4 always do, 17-18 never do (classifyRoll covers both).
  if (!attackRoll.success) return { ...base, criticalHit: false, defense: null, outcome: 'miss', damage: null, selfInjury: null };

  const criticalHit = attackRoll.outcome === 'critical-success';
  const targetManeuver = MANEUVER_EFFECTS[targetState.maneuver];
  let defense: AttackResult['defense'] = null;
  if (!criticalHit && targetManeuver.canDefend) {
    const dodgeBonus = targetManeuver.dodgeBonus;
    const defenseModifiers =
      dodgeBonus === 0
        ? targetState.modifiers
        : targetState.modifiers.add({ label: targetState.maneuver, value: dodgeBonus, appliesTo: [ROLL_TAGS.dodge] }).set;
    defense = rollSuccess(dice, {
      skill: target.dodge,
      modifiers: defenseModifiers,
      tags: [ROLL_TAGS.defense, ROLL_TAGS.dodge],
    });
    if (defense.success) return { ...base, criticalHit, defense, outcome: 'defended', damage: null, selfInjury: null };
  }

  const { roll, basic } = rollDamage(dice, attack.damage.notation, attack.damage.type);
  const injury = resolveInjury({ basic, dr: target.dr, type: attack.damage.type });
  // p.379, "Hurting Yourself": an unarmed hit on DR 3+ costs the attacker 1 crushing damage per
  // 5 of basic damage rolled, up to the target's DR.
  const selfInjury =
    attack.unarmed && target.dr >= 3
      ? resolveInjury({ basic: Math.min(Math.floor(basic / 5), target.dr), dr: 0, type: 'cr' })
      : null;
  return { ...base, criticalHit, defense, outcome: 'hit', damage: { roll, type: attack.damage.type, injury }, selfInjury };
}
