import { combatStats, type CombatStats, type GurpsCharacter } from '@gurps-sheet/character';
import { isWoundingType, type WoundingType } from '../rules/damage.js';

/** One way a combatant can attack in melee: a weapon mode, or an unarmed strike. */
export interface AttackOption {
  readonly id: string;
  readonly name: string;
  /** The skill level the attack roll is made against, before modifiers. */
  readonly skill: number;
  readonly damage: { readonly notation: string; readonly type: WoundingType };
  /** A strike with the body (the punch). Hitting armor with one can hurt the attacker (Basic Set p.379). */
  readonly unarmed: boolean;
}

/**
 * The fixed, rules-facing view of one fighter. Current HP is not here: it lives
 * in the combat state, inside `character`.
 */
export interface Combatant {
  readonly id: string;
  readonly name: string;
  /** Combatants on the same side don't fight each other. */
  readonly side: string;
  readonly basicSpeed: number;
  readonly dx: number;
  /** Dodge at no encumbrance. Encumbrance levels are not modelled yet. */
  readonly dodge: number;
  /** Torso DR. Hit locations are not modelled yet, so every hit lands on the torso (p.378). */
  readonly dr: number;
  readonly attacks: readonly AttackOption[];
  /** The sheet this fighter starts from. A reset restores HP from it. */
  readonly character: GurpsCharacter;
}

export interface CombatantOptions {
  readonly side: string;
  /** Defaults to the character's name, lowercased with dashes. */
  readonly id?: string;
  /** Weapon name -> skill name, for weapons whose name doesn't match any skill. */
  readonly weaponSkills?: Readonly<Record<string, string>>;
}

export interface CombatantResult {
  readonly combatant: Combatant;
  /** Things on the sheet that couldn't be turned into attacks. */
  readonly warnings: readonly string[];
}

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

const UNARMED_SKILLS = new Set(['brawling', 'briga']);

/**
 * Builds a combatant from a sheet. The sheet doesn't link weapons to skills, so a
 * weapon uses the skill whose name (or one of its "/"-separated parts, like
 * "Machado/Maça") matches the weapon's name, unless `weaponSkills` says otherwise.
 * Weapons that can't be matched, or whose damage type isn't modelled, are left out
 * with a warning. A character with the Brawling skill also gets a punch.
 */
export function combatantFromCharacter(character: GurpsCharacter, options: CombatantOptions): CombatantResult {
  const stats = combatStats(character);
  const warnings: string[] = [];
  const attacks = [...meleeAttacks(stats, options.weaponSkills ?? {}, warnings), ...unarmedAttacks(stats)];
  if (attacks.length === 0) {
    const ranged = stats.weapons.ranged.length;
    warnings.push(
      `${stats.name} has no melee attack the engine can use` +
        (ranged > 0 ? ` (${ranged} ranged weapon${ranged === 1 ? '' : 's'}, which aren't modelled yet)` : ''),
    );
  }

  // DR on other locations alone (a marshal's boots) is fine: torso DR is 0. But an entry the sheet
  // didn't classify might be the torso, so don't guess silently.
  const torso = stats.damageResistance.find((entry) => entry.locationId === 'torso');
  const unclassified = stats.damageResistance.filter((entry) => entry.locationId === undefined);
  if (!torso && unclassified.length > 0) {
    const labels = unclassified.map((entry) => `"${entry.location}"`).join(', ');
    warnings.push(`${stats.name} has DR entries with no locationId (${labels}) and none is the torso, so DR 0 is used`);
  }

  const combatant: Combatant = {
    id: options.id ?? normalize(stats.name).replace(/\s+/g, '-'),
    name: stats.name,
    side: options.side,
    basicSpeed: stats.basicSpeed,
    dx: stats.attributes.dx,
    dodge: stats.dodge,
    dr: torso?.dr ?? 0,
    attacks,
    character,
  };
  return { combatant, warnings };
}

function diceNotation(count: number, adds: number): string {
  return `${count}d${adds > 0 ? `+${adds}` : adds < 0 ? String(adds) : ''}`;
}

/** A skill by its full name ("Machado/Maça") or by any one "/"-separated part of it ("Machado"). */
function findSkillLevel(stats: CombatStats, skillName: string): number | undefined {
  const wanted = normalize(skillName);
  return stats.skills.find((skill) => {
    const name = normalize(skill.name);
    return name === wanted || name.split('/').some((part) => part.trim() === wanted);
  })?.level;
}

/**
 * The skill for a weapon: the explicit mapping if there is one, else a skill named like
 * the weapon (in full, or by one "/"-separated part). Only if none does, a skill whose
 * name starts the weapon's ("Espada" for "Espada larga"), so a longer, more exact skill
 * is never shadowed by a shorter one that happens to come first on the sheet.
 */
function skillForWeapon(stats: CombatStats, weaponName: string, overrides: Readonly<Record<string, string>>) {
  if (Object.hasOwn(overrides, weaponName)) return findSkillLevel(stats, overrides[weaponName]!);
  const exact = findSkillLevel(stats, weaponName);
  if (exact !== undefined) return exact;
  const wanted = normalize(weaponName);
  return stats.skills.find((skill) =>
    normalize(skill.name)
      .split('/')
      .some((part) => wanted.startsWith(`${part.trim()} `)),
  )?.level;
}

function meleeAttacks(stats: CombatStats, overrides: Readonly<Record<string, string>>, warnings: string[]): AttackOption[] {
  const attacks: AttackOption[] = [];
  for (const weapon of stats.weapons.melee) {
    const skill = skillForWeapon(stats, weapon.name, overrides);
    if (skill === undefined) {
      warnings.push(
        Object.hasOwn(overrides, weapon.name)
          ? `Weapon "${weapon.name}" is mapped to skill "${overrides[weapon.name]}", which ${stats.name} doesn't have`
          : `No skill found for weapon "${weapon.name}"; pass weaponSkills to map it`,
      );
      continue;
    }
    (weapon.damage ?? []).forEach((mode, index) => {
      const { type } = mode;
      if (type === undefined) {
        warnings.push(`Weapon "${weapon.name}" mode ${index + 1} has damage the sheet gives only as text (${mode.notation}), which isn't modelled yet`);
        return;
      }
      if (!isWoundingType(type)) {
        warnings.push(`Weapon "${weapon.name}" mode ${index + 1} has damage type "${type}", which isn't modelled yet`);
        return;
      }
      const damage = damageFor(stats, mode);
      if (!damage) {
        warnings.push(`Weapon "${weapon.name}" mode ${index + 1} has no structured damage (${mode.notation})`);
        return;
      }
      if (damage.dice < 1) {
        warnings.push(`Weapon "${weapon.name}" mode ${index + 1} does flat damage (${mode.notation}), which isn't modelled yet`);
        return;
      }
      attacks.push({
        id: `${weapon.name}#${index + 1}`,
        name: (weapon.damage?.length ?? 0) > 1 ? `${weapon.name} (${mode.base ?? mode.notation})` : weapon.name,
        skill,
        damage: { notation: diceNotation(damage.dice, damage.adds), type },
        unarmed: false,
      });
    });
  }
  return attacks;
}

function damageFor(
  stats: CombatStats,
  mode: { base?: 'thrust' | 'swing' | 'fixed'; dice?: number; adds?: number },
): { dice: number; adds: number } | undefined {
  const weaponAdds = mode.adds ?? 0;
  if (mode.base === 'thrust' || mode.base === 'swing') {
    const { dice, adds } = stats.damage[mode.base];
    return { dice, adds: adds + weaponAdds };
  }
  if (mode.base === 'fixed' && mode.dice !== undefined) return { dice: mode.dice, adds: weaponAdds };
  return undefined;
}

/**
 * A punch (Basic Set p.269: thr-1 cr). Brawling at DX+2 or better adds +1 per die
 * to basic thrust damage (p.182).
 */
function unarmedAttacks(stats: CombatStats): AttackOption[] {
  const brawling = stats.skills.find((skill) => UNARMED_SKILLS.has(normalize(skill.name)));
  if (!brawling) return [];
  const { dice, adds } = stats.damage.thrust;
  const bonus = brawling.level >= stats.attributes.dx + 2 ? dice : 0;
  return [
    {
      id: 'punch',
      name: 'Punch',
      skill: brawling.level,
      damage: { notation: diceNotation(dice, adds - 1 + bonus), type: 'cr' },
      unarmed: true,
    },
  ];
}
