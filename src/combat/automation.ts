import { ModifierSet } from '../modifiers/modifier-set.js';
import type { Combat, CombatView, FighterView } from './combat.js';
import type { AttackOption } from './combatant.js';
import { expectedInjury } from './expectation.js';
import { MANEUVER_EFFECTS } from './maneuvers.js';
import { isAttackAction, ROLL_TAGS, type AttackAction, type TurnAction, type TurnResult } from './types.js';

/** Chooses the current fighter's action from the legal ones. */
export type Policy = (view: CombatView, legal: readonly TurnAction[]) => TurnAction;

const modifierTotal = (fighter: FighterView, tags: readonly string[]) => new ModifierSet(fighter.modifiers).total(tags);

/** The Dodge a fighter would roll right now, or null if its current maneuver forbids defending. */
function dodgeOf(fighter: FighterView): number | null {
  const effects = MANEUVER_EFFECTS[fighter.maneuver];
  if (!effects.canDefend) return null;
  return fighter.dodge + effects.dodgeBonus + modifierTotal(fighter, [ROLL_TAGS.defense, ROLL_TAGS.dodge]);
}

/** Average HP an attack takes off `target`, never counting more than the HP it has left. */
function expectedDamage(attacker: FighterView, attack: AttackOption, target: FighterView, extraBonus: number, defends: boolean): number {
  const dodge = defends ? dodgeOf(target) : null;
  const e = expectedInjury({
    skill: attack.skill + extraBonus + modifierTotal(attacker, [ROLL_TAGS.attack]),
    damage: attack.damage,
    targetDr: target.dr,
    dodge,
  });
  return Math.min(e, Math.max(target.hp.current, 0));
}

/**
 * Picks the attack, target and maneuver with the best expected result:
 *  - the (attack, target) pair that is expected to take the most HP off a target, counting no
 *    more than that target has left (no credit for overkill; ties go to the enemy with fewer
 *    HP). It does not value a kill beyond the HP it removes;
 *  - All-Out Attack (+4 to hit, but no defense until the next turn) when the extra damage it
 *    deals is worth more than the extra damage the enemies are expected to deal back to an
 *    undefended fighter, otherwise a plain Attack;
 *  - All-Out Defense when there is nothing to attack.
 * Each enemy is assumed to attack once before this fighter's next turn, with its best attack.
 */
export const bestExpectedInjury: Policy = (view, legal) => {
  const actor = view.fighters.find((fighter) => fighter.id === view.currentId);
  const fighterById = (id: string) => view.fighters.find((fighter) => fighter.id === id);
  if (!actor) return { maneuver: 'all-out-defense' };

  let best: { action: AttackAction; attack: AttackOption; target: FighterView; value: number } | undefined;
  for (const action of legal.filter(isAttackAction)) {
    if (action.maneuver !== 'attack') continue; // All-Out Attack is decided below
    const attack = actor.attacks.find((option) => option.id === action.attackId);
    const target = fighterById(action.targetId);
    if (!attack || !target) continue;
    const value = expectedDamage(actor, attack, target, 0, true);
    if (!best || value > best.value || (value === best.value && target.hp.current < best.target.hp.current)) {
      best = { action, attack, target, value };
    }
  }
  if (!best) return { maneuver: 'all-out-defense' };

  const gain = expectedDamage(actor, best.attack, best.target, MANEUVER_EFFECTS['all-out-attack'].attackBonus, true) - best.value;
  const risk = view.fighters
    .filter((enemy) => enemy.side !== actor.side && !enemy.defeated)
    .reduce((sum, enemy) => sum + extraDamageIfUndefended(enemy, actor), 0);

  return { ...best.action, maneuver: gain > risk ? 'all-out-attack' : 'attack' };
};

/**
 * How much more HP `enemy` is expected to take off `us` with its best attack if we can't
 * dodge it than if we can (an Attack leaves us a Dodge; an All-Out Attack doesn't).
 */
function extraDamageIfUndefended(enemy: FighterView, us: FighterView): number {
  // The enemy's pick is the attack that does the most against a fighter who dodges.
  const dodging: FighterView = { ...us, maneuver: 'attack' };
  let extra = 0;
  let bestDodged = -1;
  for (const attack of enemy.attacks) {
    const dodged = expectedDamage(enemy, attack, dodging, 0, true);
    if (dodged > bestDodged) {
      bestDodged = dodged;
      extra = expectedDamage(enemy, attack, dodging, 0, false) - dodged;
    }
  }
  return extra;
}

export interface RunOptions {
  /** Stop after this many turns even if nobody has won (e.g. armor nobody can penetrate). */
  readonly maxTurns?: number;
}

export interface RunResult {
  readonly results: readonly TurnResult[];
  /** False if `maxTurns` ran out first. */
  readonly finished: boolean;
}

/** Plays turns with `policy` until one side is left standing. */
export function runToCompletion(combat: Combat, policy: Policy, { maxTurns = 1000 }: RunOptions = {}): RunResult {
  const results: TurnResult[] = [];
  while (combat.view().status === 'in-progress' && results.length < maxTurns) {
    results.push(combat.takeTurn(policy(combat.view(), combat.legalActions())));
  }
  return { results, finished: combat.view().status === 'finished' };
}
