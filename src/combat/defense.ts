import type { DiceManager } from '../dice/dice-manager.js';
import type { ModifierSet } from '../modifiers/modifier-set.js';
import { rollSuccess, type SuccessRollResult } from '../rules/success-roll.js';
import type { AttackOption, Combatant, ParryOption } from './combatant.js';
import { MANEUVER_EFFECTS, type DefenseKind } from './maneuvers.js';
import { ROLL_TAGS, type DefenseChoice, type DefenseOption, type FighterState } from './types.js';

/** Everything a defense roll is made against: base score, the modifiers in play, and the roll's tags. */
interface DefenseRoll {
  readonly skill: number;
  readonly modifiers: ModifierSet;
  readonly tags: readonly string[];
}

/** Adds a labelled, rule-derived modifier for this roll only, so the breakdown stays visible. */
const withBonus = (set: ModifierSet, label: string, value: number, kind: DefenseKind): ModifierSet =>
  value === 0 ? set : set.add({ label, value, appliesTo: [ROLL_TAGS.defense, ROLL_TAGS[kind]] }).set;

/**
 * The roll a defense choice is made against, or null if the choice isn't legal right now.
 * Rules (Basic Set pp.374-377, p.366):
 *  - Dodge: any number of times. Block: once per turn. Parry: an unbalanced weapon can't
 *    parry after attacking this turn; each further parry with the same weapon is -4
 *    (fencing weapons -2). A bare-handed parry is -3 against a swung weapon.
 *  - Retreat, once per turn: +3 Dodge, +1 Block, +1 Parry (+3 with fencing weapons or Boxing,
 *    Judo, Karate).
 *  - All-Out Defense: +2 to the defense it raised.
 * Not modelled: shield DB, Combat Reflexes, off-hand and thrown-weapon penalties, and the
 * retreat bonus carrying over to the same attacker's later attacks.
 */
function defenseRoll(choice: DefenseChoice, defender: Combatant, state: FighterState, attack: AttackOption): DefenseRoll | null {
  if (choice.kind === 'none' || !MANEUVER_EFFECTS[state.maneuver].canDefend) return null;
  if (choice.retreat && state.defenseUse.retreated) return null;

  const kind = choice.kind;
  let skill: number;
  let modifiers = state.modifiers;
  let retreatBonus: number;

  if (kind === 'dodge') {
    skill = defender.dodge;
    retreatBonus = 3;
  } else if (kind === 'block') {
    if (defender.block === null || state.defenseUse.blocked) return null;
    skill = defender.block;
    retreatBonus = 1;
  } else {
    if (choice.kind !== 'parry') return null; // only narrows `choice` for TypeScript: kind is 'parry' here
    const parry: ParryOption | undefined = defender.parries.find((option) => option.id === choice.parryId);
    if (!parry) return null;
    if (parry.unbalanced && state.attackedWith === parry.id) return null;
    skill = parry.value;
    retreatBonus = parry.retreatBonus;
    const earlier = state.defenseUse.parries[parry.id] ?? 0;
    modifiers = withBonus(modifiers, `Parry #${earlier + 1} this turn`, -earlier * (parry.fencing ? 2 : 4), kind);
    if (parry.unarmed && !attack.unarmed && attack.strike !== 'thrust') {
      modifiers = withBonus(modifiers, 'Bare hands vs. a weapon', -3, kind);
    }
  }

  if (state.maneuver === 'all-out-defense' && state.increased === kind) {
    modifiers = withBonus(modifiers, 'All-Out Defense', MANEUVER_EFFECTS['all-out-defense'].defenseBonus, kind);
  }
  if (choice.retreat) modifiers = withBonus(modifiers, 'Retreat', retreatBonus, kind);
  return { skill, modifiers, tags: [ROLL_TAGS.defense, ROLL_TAGS[kind]] };
}

const labelOf = (choice: DefenseChoice, defender: Combatant): string => {
  if (choice.kind === 'none') return 'No defense';
  const base =
    choice.kind === 'parry'
      ? `Parry (${defender.parries.find((option) => option.id === choice.parryId)?.name ?? choice.parryId})`
      : choice.kind === 'dodge'
        ? 'Dodge'
        : 'Block';
  return choice.retreat ? `${base} + retreat` : base;
};

/** Every defense the defender may use against `attack` right now (not including `none`): Dodge, each parry, Block, then the same with a retreat. */
export function defenseOptions(defender: Combatant, state: FighterState, attack: AttackOption): DefenseOption[] {
  const candidates: DefenseChoice[] = [];
  for (const retreat of [false, true]) {
    candidates.push({ kind: 'dodge', retreat });
    for (const parry of defender.parries) candidates.push({ kind: 'parry', parryId: parry.id, retreat });
    candidates.push({ kind: 'block', retreat });
  }
  return candidates.flatMap((choice) => {
    const roll = defenseRoll(choice, defender, state, attack);
    return roll ? [{ choice, label: labelOf(choice, defender), target: roll.skill + roll.modifiers.total(roll.tags) }] : [];
  });
}

/** Rolls a defense that `defenseOptions` listed. */
export function rollDefense(
  dice: DiceManager,
  choice: DefenseChoice,
  defender: Combatant,
  state: FighterState,
  attack: AttackOption,
): SuccessRollResult {
  const roll = defenseRoll(choice, defender, state, attack);
  if (!roll) throw new RangeError(`${labelOf(choice, defender)} is not available to ${defender.name}`);
  return rollSuccess(dice, roll);
}

export const NO_DEFENSE: DefenseOption = { choice: { kind: 'none' }, label: 'No defense', target: null };

export const sameDefense = (a: DefenseChoice, b: DefenseChoice): boolean =>
  a.kind === b.kind &&
  (a.kind === 'none' ||
    ((b.kind !== 'none' && a.retreat === b.retreat) &&
      (a.kind !== 'parry' || (b.kind === 'parry' && a.parryId === b.parryId))));
