import type { GurpsCharacter } from '@gurps-sheet/character';
import type { DiceRoll } from '../dice/dice-manager.js';
import type { ModifierPatch, ModifierSet, NewModifier } from '../modifiers/modifier-set.js';
import type { SuccessRollResult } from '../rules/success-roll.js';
import type { InjuryResult, WoundingType } from '../rules/damage.js';
import { isAttackManeuver, type DefenseKind, type Maneuver } from './maneuvers.js';

/** Tags that select which modifiers apply to a roll (see `ModifierSet.total`). */
export const ROLL_TAGS = {
  attack: 'attack',
  /** Any active defense. */
  defense: 'defense',
  dodge: 'dodge',
  parry: 'parry',
  block: 'block',
} as const;

export interface DoNothingAction {
  readonly maneuver: 'do-nothing';
}

export interface AllOutDefenseAction {
  readonly maneuver: 'all-out-defense';
  /** The defense that gets +2 until the fighter's next turn. */
  readonly increase: DefenseKind;
}

export type PassiveAction = DoNothingAction | AllOutDefenseAction;

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

/** How a defender answers an attack. `none` takes the hit; any other choice is rolled. */
export type DefenseChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'dodge' | 'block'; readonly retreat: boolean }
  | { readonly kind: 'parry'; readonly parryId: string; readonly retreat: boolean };

/** A defense the defender may choose right now, with the number it would roll against. */
export interface DefenseOption {
  readonly choice: DefenseChoice;
  /** For menus: "Parry (Broadsword) + retreat". */
  readonly label: string;
  /** Roll this or less, every modifier included; null for `none`. */
  readonly target: number | null;
}

/** The attack a defender has to answer: everything decided so far in the attacker's turn. */
export interface PendingAttack {
  readonly round: number;
  readonly actorId: string;
  readonly maneuver: 'attack' | 'all-out-attack';
  readonly attackId: string;
  readonly targetId: string;
  readonly attackRoll: SuccessRollResult;
}

/** What `takeTurn` returns: the finished turn, or an attack waiting for the defender's choice. */
export type TurnStep =
  | { readonly status: 'resolved'; readonly result: TurnResult }
  | { readonly status: 'awaiting-defense'; readonly pending: PendingAttack };

export type AttackOutcome = 'miss' | 'defended' | 'hit';

export interface DamageOutcome {
  /** The damage dice as rolled. `injury.basic` is the amount after the minimum is applied. */
  readonly roll: DiceRoll;
  readonly type: WoundingType;
  readonly injury: InjuryResult;
}

export interface DefenseResult {
  readonly choice: DefenseChoice;
  /** Null when the defender chose `none`. */
  readonly roll: SuccessRollResult | null;
}

export interface AttackResult {
  readonly targetId: string;
  readonly attackId: string;
  readonly attackRoll: SuccessRollResult;
  /** A critical success on an attack: it can't be defended against (Basic Set p.374). */
  readonly criticalHit: boolean;
  /** The defender's choice and roll, or null if it couldn't defend (missed attack, critical hit, All-Out Attack...). */
  readonly defense: DefenseResult | null;
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
  /** The defense an All-Out Defense raised, otherwise null. */
  readonly increase: DefenseKind | null;
  readonly attack: AttackResult | null;
}

/** Defenses a fighter has used since its own last turn: they are limited per turn (pp.375-377). */
export interface DefenseUse {
  /** Parries made so far, by parry id: each extra parry with the same weapon is harder. */
  readonly parries: Readonly<Record<string, number>>;
  /** One block per turn. */
  readonly blocked: boolean;
  /** One retreat per turn. */
  readonly retreated: boolean;
}

/** One fighter's state during the fight. */
export interface FighterState {
  /** Holds the current HP; changed only through the sheet library's helpers. */
  readonly character: GurpsCharacter;
  /** Governs the fighter's defenses until its next turn. */
  readonly maneuver: Maneuver;
  /** The defense raised by its All-Out Defense, if that is its current maneuver. */
  readonly increased: DefenseKind | null;
  /** The weapon it attacked with on its last turn: an unbalanced one can't parry until its next turn (p.376). */
  readonly attackedWith: string | null;
  readonly defenseUse: DefenseUse;
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
  /** The attack waiting for a defense, while the state is `awaiting-defense`. */
  readonly pending: PendingAttack | null;
  /** The side left standing, once only one is. */
  readonly winner: string | null;
}

/**
 * `in-progress`: waiting for the current fighter's action. `awaiting-defense`: an attack
 * hit and the defender must choose a defense. `finished`: at most one side is standing.
 */
export type CombatState = 'in-progress' | 'awaiting-defense' | 'finished';

/**
 * Everything that changes a fight, as plain data: the history of these events is a log that
 * can be serialized, and replaying it in order rebuilds the same state (modifier ids included).
 */
export type CombatEvent =
  | { readonly type: 'AWAIT_DEFENSE'; readonly pending: PendingAttack }
  | { readonly type: 'RESOLVE_TURN'; readonly result: TurnResult; readonly at: Date }
  | { readonly type: 'ADD_MODIFIER'; readonly fighterId: string; readonly modifier: NewModifier }
  | { readonly type: 'UPDATE_MODIFIER'; readonly fighterId: string; readonly modifierId: string; readonly patch: ModifierPatch }
  | { readonly type: 'REMOVE_MODIFIER'; readonly fighterId: string; readonly modifierId: string };
