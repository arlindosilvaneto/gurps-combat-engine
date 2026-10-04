import { ModifierSet } from '../modifiers/modifier-set.js';
import type { Combat, CombatView, FighterView } from './combat.js';
import type { AttackOption } from './combatant.js';
import { expectedInjury } from './expectation.js';
import { MANEUVER_EFFECTS, type DefenseKind } from './maneuvers.js';
import {
  isAttackAction,
  ROLL_TAGS,
  type AttackAction,
  type DefenseChoice,
  type DefenseOption,
  type TurnAction,
  type TurnResult,
} from './types.js';

/** Chooses the current fighter's action from the legal ones. */
export type Policy = (view: CombatView, legal: readonly TurnAction[]) => TurnAction;

/** Chooses how the defender answers a pending attack, from the legal defenses (`view.pending` is the attack). */
export type DefensePolicy = (view: CombatView, legal: readonly DefenseOption[]) => DefenseChoice;

/**
 * The defense most likely to succeed: the highest target number. On a tie it keeps the
 * retreat (once per turn) for later. Takes the hit only when there is nothing else.
 */
export const bestDefense: DefensePolicy = (_view, legal) => {
  let best: DefenseOption | undefined;
  for (const option of legal) {
    if (option.target === null) continue;
    const retreats = option.choice.kind !== 'none' && option.choice.retreat;
    const bestRetreats = best !== undefined && best.choice.kind !== 'none' && best.choice.retreat;
    if (!best || option.target > best.target! || (option.target === best.target && bestRetreats && !retreats)) best = option;
  }
  return best?.choice ?? { kind: 'none' };
};

const modifierTotal = (fighter: FighterView, tags: readonly string[]) => new ModifierSet(fighter.modifiers).total(tags);

/** A fighter's base score in each defense it has. */
function defenseScores(fighter: FighterView): Array<[DefenseKind, number]> {
  const scores: Array<[DefenseKind, number]> = [['dodge', fighter.dodge]];
  for (const parry of fighter.parries) scores.push(['parry', parry.value]);
  if (fighter.block !== null) scores.push(['block', fighter.block]);
  return scores;
}

/**
 * Roughly the defense a fighter would roll right now: its best defense with modifiers and
 * any All-Out Defense bonus, or null if its maneuver forbids defending. It ignores retreats
 * and per-turn limits (a block already used, repeated parries).
 */
function estimatedDefense(fighter: FighterView): number | null {
  const effects = MANEUVER_EFFECTS[fighter.maneuver];
  if (!effects.canDefend) return null;
  return Math.max(
    ...defenseScores(fighter).map(
      ([kind, score]) =>
        score +
        (fighter.maneuver === 'all-out-defense' && fighter.increased === kind ? effects.defenseBonus : 0) +
        modifierTotal(fighter, [ROLL_TAGS.defense, ROLL_TAGS[kind]]),
    ),
  );
}

/** Average HP an attack takes off `target`, never counting more than the HP it has left. */
function expectedDamage(attacker: FighterView, attack: AttackOption, target: FighterView, extraBonus: number, defends: boolean): number {
  const e = expectedInjury({
    skill: attack.skill + extraBonus + modifierTotal(attacker, [ROLL_TAGS.attack]),
    damage: attack.damage,
    targetDr: target.dr,
    defense: defends ? estimatedDefense(target) : null,
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
 *  - with nothing to attack, All-Out Defense raising its best defense.
 * Each enemy is assumed to attack once before this fighter's next turn, with its best attack.
 */
export const bestExpectedInjury: Policy = (view, legal) => {
  const actor = view.fighters.find((fighter) => fighter.id === view.currentId);
  const fighterById = (id: string) => view.fighters.find((fighter) => fighter.id === id);
  const fallback = (): TurnAction => {
    const raisable = legal.flatMap((action) => (action.maneuver === 'all-out-defense' ? [action.increase] : []));
    const scores = actor ? defenseScores(actor).filter(([kind]) => raisable.includes(kind)) : [];
    const best = scores.reduce<[DefenseKind, number] | undefined>((top, entry) => (!top || entry[1] > top[1] ? entry : top), undefined);
    return best ? { maneuver: 'all-out-defense', increase: best[0] } : { maneuver: 'do-nothing' };
  };
  if (!actor) return fallback();

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
  if (!best) return fallback();

  const gain = expectedDamage(actor, best.attack, best.target, MANEUVER_EFFECTS['all-out-attack'].attackBonus, true) - best.value;
  const risk = view.fighters
    .filter((enemy) => enemy.side !== actor.side && !enemy.defeated)
    .reduce((sum, enemy) => sum + extraDamageIfUndefended(enemy, actor), 0);

  return { ...best.action, maneuver: gain > risk ? 'all-out-attack' : 'attack' };
};

/**
 * How much more HP `enemy` is expected to take off `us` with its best attack if we can't
 * defend it than if we can (an Attack leaves us a defense; an All-Out Attack doesn't).
 */
function extraDamageIfUndefended(enemy: FighterView, us: FighterView): number {
  // The enemy's pick is the attack that does the most against a fighter who defends.
  const defending: FighterView = { ...us, maneuver: 'attack', increased: null };
  let extra = 0;
  let bestDefended = -1;
  for (const attack of enemy.attacks) {
    const defended = expectedDamage(enemy, attack, defending, 0, true);
    if (defended > bestDefended) {
      bestDefended = defended;
      extra = expectedDamage(enemy, attack, defending, 0, false) - defended;
    }
  }
  return extra;
}

export interface RunOptions {
  /** Stop after this many turns even if nobody has won (e.g. armor nobody can penetrate). */
  readonly maxTurns?: number;
  /** How defenders answer attacks. Defaults to `bestDefense`. */
  readonly defense?: DefensePolicy;
}

export interface RunResult {
  readonly results: readonly TurnResult[];
  /** False if `maxTurns` ran out first. */
  readonly finished: boolean;
}

/** Plays turns with `policy`, and answers every attack with the defense policy, until one side is left standing. */
export function runToCompletion(combat: Combat, policy: Policy, { maxTurns = 1000, defense = bestDefense }: RunOptions = {}): RunResult {
  const results: TurnResult[] = [];
  while (combat.view().status !== 'finished' && results.length < maxTurns) {
    const view = combat.view();
    if (view.status === 'awaiting-defense') {
      results.push(combat.defend(defense(view, combat.legalDefenses())));
      continue;
    }
    const step = combat.takeTurn(policy(view, combat.legalActions()));
    if (step.status === 'resolved') results.push(step.result);
  }
  return { results, finished: combat.view().status === 'finished' };
}
