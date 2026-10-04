import type { GurpsCharacter } from '@gurps-sheet/character';
import type { DiceRoll } from '../dice/dice-manager.js';
import type { ModifierPatch, ModifierSet, NewModifier } from '../modifiers/modifier-set.js';
import type { SuccessRollResult } from '../rules/success-roll.js';
import type { InjuryResult, WoundingType } from '../rules/damage.js';
import { isAttackManeuver, type Maneuver } from './maneuvers.js';

/** Tags that select which modifiers apply to a roll (see `ModifierSet.total`). */
export const ROLL_TAGS = {
  attack: 'attack',
  /** Any active defense. */
  defense: 'defense',
  dodge: 'dodge',
} as const;

export interface PassiveAction {
  readonly maneuver: 'do-nothing' | 'all-out-defense';
}

export interface AttackAction {
  readonly maneuver: 'attack' | 'all-out-attack';
  /** One of the actor's `AttackOption` ids. */
  readonly attackId: string;
  readonly targetId: string;
}

/** What the combatant whose turn it is chooses to do: one maneuver, plus its target if it attacks. */
export type TurnAction = PassiveAction | AttackAction;

export function isAttackAction(action: TurnAction): action is AttackAction {
  return isAttackManeuver(action.maneuver);
}

export type AttackOutcome = 'miss' | 'defended' | 'hit';

export interface DamageOutcome {
  /** The damage dice as rolled. `injury.basic` is the amount after the minimum is applied. */
  readonly roll: DiceRoll;
  readonly type: WoundingType;
  readonly injury: InjuryResult;
}

export interface AttackResult {
  readonly targetId: string;
  readonly attackId: string;
  readonly attackRoll: SuccessRollResult;
  /** A critical success on an attack: it can't be defended against (Basic Set p.374). */
  readonly criticalHit: boolean;
  /** The defense roll, or null if none was made (the attack missed, or the target couldn't defend). */
  readonly defense: SuccessRollResult | null;
  readonly outcome: AttackOutcome;
  /** Present only when the attack hit. */
  readonly damage: DamageOutcome | null;
  /**
   * What the attacker suffers for punching armor (Basic Set p.379), or null when the rule
   * doesn't apply: only unarmed hits on a target with DR 3 or more.
   */
  readonly selfInjury: InjuryResult | null;
}

/** Everything that happened in one turn: also the payload of the `RESOLVE_TURN` event. */
export interface TurnResult {
  readonly round: number;
  readonly actorId: string;
  readonly maneuver: Maneuver;
  readonly attack: AttackResult | null;
}

/** One fighter's state during the fight. */
export interface FighterState {
  /** Holds the current HP; changed only through the sheet library's helpers. */
  readonly character: GurpsCharacter;
  /** Governs the fighter's defenses until its next turn. */
  readonly maneuver: Maneuver;
  /** Situational modifiers added during the fight. */
  readonly modifiers: ModifierSet;
}

export interface CombatContext {
  /** Starts at 1; one round is one second. */
  readonly round: number;
  /** Fixed for the whole fight. */
  readonly order: readonly string[];
  /** Index into `order` of the fighter whose turn it is. */
  readonly turnIndex: number;
  readonly fighters: Readonly<Record<string, FighterState>>;
  /** The side left standing, once only one is. */
  readonly winner: string | null;
}

export type CombatState = 'in-progress' | 'finished';

/**
 * Everything that changes a fight, as plain data: the history of these events is a log that
 * can be serialized, and replaying it in order rebuilds the same state (modifier ids included).
 */
export type CombatEvent =
  | { readonly type: 'RESOLVE_TURN'; readonly result: TurnResult; readonly at: Date }
  | { readonly type: 'ADD_MODIFIER'; readonly fighterId: string; readonly modifier: NewModifier }
  | { readonly type: 'UPDATE_MODIFIER'; readonly fighterId: string; readonly modifierId: string; readonly patch: ModifierPatch }
  | { readonly type: 'REMOVE_MODIFIER'; readonly fighterId: string; readonly modifierId: string };
