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
