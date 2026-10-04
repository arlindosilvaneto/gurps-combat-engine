import { readFileSync } from 'node:fs';
import { CharacterError, parseCharacter } from '@gurps-sheet/character';
import { combatantFromCharacter, type Combatant } from '../combat/combatant.js';
import { npcGroup } from '../combat/npcs.js';

/** A fighter waiting in the setup screen, with what the engine couldn't use from its sheet. */
export interface RosterEntry {
  readonly combatant: Combatant;
  readonly warnings: readonly string[];
  /** Where it came from, for the roster list: an NPC id or a file path. */
  readonly source: string;
}

export const sidesOf = (roster: readonly RosterEntry[]): string[] => [...new Set(roster.map((entry) => entry.combatant.side))];

/**
 * Adds entries, renaming any whose id or name is already taken ("Town Guard" becomes
 * "Town Guard 2", id "fantasy-town-guard-2"), since a combat needs unique ids.
 */
export function addToRoster(roster: readonly RosterEntry[], entries: readonly RosterEntry[]): RosterEntry[] {
  const result = [...roster];
  for (const entry of entries) {
    const ids = new Set(result.map((e) => e.combatant.id));
    const names = new Set(result.map((e) => e.combatant.name));
    let { id, name } = entry.combatant;
    for (let n = 2; ids.has(id); n += 1) id = `${entry.combatant.id}-${n}`;
    for (let n = 2; names.has(name); n += 1) name = `${entry.combatant.name} ${n}`;
    result.push({ ...entry, combatant: { ...entry.combatant, id, name } });
  }
  return result;
}

export function npcEntries(npc: string, side: string, count: number): RosterEntry[] {
  return npcGroup({ npc, side, count }).map(({ combatant, warnings }) => ({ combatant, warnings, source: npc }));
}

/** Loads a gurps-character file. Throws an `Error` with a message fit to show the user. */
export function sheetEntry(path: string, side: string): RosterEntry {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Can't read "${path}": ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (error as Error).message}`);
  }
  try {
    const { character } = parseCharacter(text);
    const { combatant, warnings } = combatantFromCharacter(character, { side });
    return { combatant, warnings, source: path };
  } catch (error) {
    if (error instanceof CharacterError) throw new Error(`"${path}" is not a usable gurps-character file: ${error.message}`);
    throw error;
  }
}

/** `id[:side[:count]]`, e.g. "fantasy-town-guard:watch:3". */
export function parseNpcSpec(spec: string): { npc: string; side: string; count: number } {
  const [npc = '', side = 'npcs', countText = '1'] = spec.split(':');
  const count = Number(countText);
  if (!npc) throw new Error(`--npc "${spec}": expected <npc-id>[:<side>[:<count>]]`);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--npc "${spec}": the count must be a whole number of at least 1`);
  return { npc, side: side || 'npcs', count };
}

/** `path[:side]`. The text after the last ":" is a side only if it doesn't look like part of a path. */
export function parseSheetSpec(spec: string): { path: string; side: string } {
  const at = spec.lastIndexOf(':');
  const suffix = at > 0 ? spec.slice(at + 1) : '';
  if (suffix && !/[\\/.]/.test(suffix)) return { path: spec.slice(0, at), side: suffix };
  return { path: spec, side: 'players' };
}
