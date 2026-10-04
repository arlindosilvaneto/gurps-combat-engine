import { getNpc } from '@gurps-sheet/npcs';
import { MELEE_WEAPONS } from '@gurps-sheet/npcs/catalog';
import { combatantFromCharacter, type CombatantResult } from './combatant.js';

/**
 * Basic Set melee weapon name -> the skill it uses (Melee Weapon Table, p.271). A sheet doesn't
 * record which skill a weapon uses, but the NPC library's catalog does, and its NPCs are built
 * from it, so the names line up with the skills on their sheets.
 */
const WEAPON_SKILLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(MELEE_WEAPONS).map((weapon) => [weapon.name, weapon.skill.name]),
);

export interface NpcCombatantOptions {
  readonly side: string;
  /** Defaults to the NPC's id, e.g. "fantasy-town-guard". Must be unique within a combat. */
  readonly id?: string;
  /** Defaults to the name on the NPC's sheet. */
  readonly name?: string;
}

/**
 * A combatant built from one of the `@gurps-sheet/npcs` library's NPCs. Every call builds from
 * a fresh copy of the sheet, so two combatants made from the same NPC are independent: hurting
 * one doesn't touch the other. Throws, listing the known ids, if `npcId` isn't an NPC.
 *
 * Warnings say what the engine couldn't use: ranged weapons, text-only damage and the like.
 * Some NPCs (casters, doctors, shooters) come back with no attack at all.
 */
export function npcCombatant(npcId: string, { side, id = npcId, name }: NpcCombatantOptions): CombatantResult {
  const { combatant, warnings } = combatantFromCharacter(getNpc(npcId), { side, id, weaponSkills: WEAPON_SKILLS });
  return { combatant: name === undefined ? combatant : { ...combatant, name }, warnings };
}

export interface NpcGroupSpec {
  readonly npc: string;
  readonly side: string;
  /** How many of them. Defaults to 1. */
  readonly count?: number;
}

/**
 * `count` copies of one NPC. A group of several is numbered ("Town Guard 1", id
 * "fantasy-town-guard-1", ...) so the copies can be told apart; a single one keeps its plain id and name.
 */
export function npcGroup({ npc, side, count = 1 }: NpcGroupSpec): CombatantResult[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`An NPC group needs a count of at least 1, got ${count}`);
  const first = npcCombatant(npc, { side });
  if (count === 1) return [first];
  return Array.from({ length: count }, (_, index) =>
    npcCombatant(npc, { side, id: `${npc}-${index + 1}`, name: `${first.combatant.name} ${index + 1}` }),
  );
}
