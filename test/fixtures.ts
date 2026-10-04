import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDamage, parseCharacter, type GurpsCharacter } from '@gurps-sheet/character';
import {
  combatantFromCharacter,
  createCombat,
  createDiceManager,
  scriptedSource,
  type Combat,
  type Combatant,
  type DefenseChoice,
  type DiceManager,
  type TurnAction,
  type TurnResult,
} from '../src/index.js';

export const FIXED_TIME = new Date('2026-01-01T00:00:00.000Z');

// The package's `exports` doesn't expose its examples, so locate them from its package.json.
const packageDir = dirname(fileURLToPath(import.meta.resolve('@gurps-sheet/character/package.json')));

export function loadExample(name: 'rurik.json' | 'jotun.json'): GurpsCharacter {
  return parseCharacter(readFileSync(join(packageDir, 'examples', name), 'utf8')).character;
}

/** A dice manager that plays back exactly these faces, in order. */
export function scripted(...faces: number[]): DiceManager {
  return createDiceManager({ source: scriptedSource(faces) });
}

export interface FighterOptions {
  readonly side: string;
  readonly id?: string;
  /** HP to remove from the sheet before the fight. */
  readonly damage?: number;
}

/**
 * Combatants built from the library's example sheets (HP/Speed/DX/Dodge/DR/attacks):
 *  - Rurik: 15 HP, Speed 6, DX 12, Dodge 9, torso DR 4. Axe: skill 13, 2d+1 cut. Punch: skill 12, 1d-1 cr.
 *  - Fenrir (jotun.json): 24 HP, Speed 6.5, DX 13, Dodge 12, no DR. Punch: skill 14, 2d-2 cr.
 * Fenrir is faster, so he acts first.
 */
export function fighter(example: 'rurik.json' | 'jotun.json', { side, id, damage = 0 }: FighterOptions): Combatant {
  let character = loadExample(example);
  if (damage > 0) character = applyDamage(character, damage, { now: FIXED_TIME });
  const { combatant, warnings } = combatantFromCharacter(character, id === undefined ? { side } : { side, id });
  assert.deepEqual(warnings, []);
  return combatant;
}

export const rurik = (options: Partial<FighterOptions> = {}) => fighter('rurik.json', { side: 'a', ...options });
export const fenrir = (options: Partial<FighterOptions> = {}) => fighter('jotun.json', { side: 'b', ...options });

export const RURIK = 'rurik-bjornsson';
export const FENRIR = 'fenrir';

export function newCombat(dice: DiceManager, combatants: readonly Combatant[] = [rurik(), fenrir()]): Combat {
  return createCombat(combatants, { dice, clock: () => FIXED_TIME });
}

export function hp(combat: Combat, id: string): number {
  const view = combat.view().fighters.find((candidate) => candidate.id === id);
  assert.ok(view, `no fighter ${id}`);
  return view.hp.current;
}

/** Plays a whole turn: the action, then, if the attack waits for a defense, the given choice (Dodge by default). */
export function play(combat: Combat, action: TurnAction, defense: DefenseChoice = { kind: 'dodge', retreat: false }): TurnResult {
  const step = combat.takeTurn(action);
  return step.status === 'resolved' ? step.result : combat.defend(defense);
}
