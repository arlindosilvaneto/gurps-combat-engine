export { createDiceManager } from './dice/dice-manager.js';
export type { DiceManager, DiceManagerOptions, DiceRoll, TableRoll } from './dice/dice-manager.js';
export { parseNotation } from './dice/notation.js';
export type { DiceNotation } from './dice/notation.js';
export { randomSource, seededSource, scriptedSource } from './dice/sources.js';
export type { DieSource, ScriptedDieSource } from './dice/sources.js';
export { createTable, lookup } from './dice/tables.js';
export type { ResultTable, TableEntry, TableSpec } from './dice/tables.js';

export { ModifierSet } from './modifiers/modifier-set.js';
export type { Modifier, ModifierPatch, NewModifier } from './modifiers/modifier-set.js';

export { classifyRoll, rollSuccess } from './rules/success-roll.js';
export type {
  RollClassification,
  RollOutcome,
  SuccessRollOptions,
  SuccessRollResult,
} from './rules/success-roll.js';

export { isWoundingType, resolveInjury, rollDamage, woundingMultiplier } from './rules/damage.js';
export { isMajorWound, knockdownOutcome, MAX_SHOCK, shockPenalty } from './rules/injury.js';
export type { KnockdownOutcome } from './rules/injury.js';
export type { DamageRoll, InjuryResult, WoundingType } from './rules/damage.js';

export { MANEUVER_EFFECTS, isAttackManeuver } from './combat/maneuvers.js';
export type { DefenseKind, Maneuver, ManeuverEffects } from './combat/maneuvers.js';
export { combatantFromCharacter } from './combat/combatant.js';
export type { AttackOption, Combatant, CombatantOptions, CombatantResult, ParryOption } from './combat/combatant.js';
export { npcCombatant, npcGroup } from './combat/npcs.js';
export type { NpcCombatantOptions, NpcGroupSpec } from './combat/npcs.js';
export { listNpcs } from '@gurps-sheet/npcs';
export type { NpcFilter, NpcSummary } from '@gurps-sheet/npcs';
export { turnOrder } from './combat/turn-order.js';
export type { Initiative } from './combat/turn-order.js';
export { createCombat, CombatError } from './combat/combat.js';
export type { Combat, CombatOptions, CombatView, FighterView } from './combat/combat.js';
export { bestDefense, bestExpectedInjury, runToCompletion } from './combat/automation.js';
export { diceDistribution, expectedInjury, successChance } from './combat/expectation.js';
export type { ExpectedInjuryInput } from './combat/expectation.js';
export type { DefensePolicy, Policy, RunOptions, RunResult } from './combat/automation.js';
export { isAttackAction, ROLL_TAGS } from './combat/types.js';
export type {
  AttackAction,
  AttackOutcome,
  AllOutDefenseAction,
  AttackResult,
  CombatContext,
  CombatEvent,
  CombatState,
  DamageOutcome,
  DefenseChoice,
  DefenseOption,
  DefenseResult,
  DefenseUse,
  DoNothingAction,
  FighterState,
  PassiveAction,
  PendingAttack,
  TurnAction,
  TurnResult,
  TurnStep,
} from './combat/types.js';

export { createMachine, InvalidTransitionError } from './machine/machine.js';
export type {
  EventOf,
  HistoryEntry,
  Machine,
  MachineDefinition,
  MachineEvent,
  Snapshot,
  StateDefinition,
  Transition,
} from './machine/machine.js';
