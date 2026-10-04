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
  /** The weapon this attack is made with, or null for an unarmed strike. */
  readonly weapon: string | null;
  /** Swing or thrust, when known: a bare-handed parry is harder against a swung weapon (p.377). */
  readonly strike: 'swing' | 'thrust' | null;
}

/** One way a combatant can parry: with a weapon, or bare-handed (Basic Set pp.376-377). */
export interface ParryOption {
  /** The weapon's name, or "bare-hands". */
  readonly id: string;
  readonly name: string;
  /** 3 + half the skill, plus the weapon's parry modifier. */
  readonly value: number;
  /** An unbalanced ("U") weapon can't parry once it has attacked this turn. */
  readonly unbalanced: boolean;
  /** A fencing ("F") weapon: extra parries cost -2 each instead of -4. */
  readonly fencing: boolean;
  readonly unarmed: boolean;
  /** Parry bonus for retreating: +3 for fencing weapons and Boxing, Judo or Karate, else +1 (p.377). */
  readonly retreatBonus: 1 | 3;
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
  /** Ways it can parry. Empty if none of its weapons can (a lance) and it isn't fighting bare-handed. */
  readonly parries: readonly ParryOption[];
  /** Block (3 + half the Shield skill) from the sheet, or null without a shield skill. Shield DB is not included. */
  readonly block: number | null;
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
/** Skills that parry bare-handed (p.376), and those of them that get +3 for a retreat (p.377). */
const BARE_HAND_PARRY_SKILLS = new Set(['boxing', 'boxe', 'brawling', 'briga', 'judo', 'karate', 'carate']);
const MOBILE_PARRY_SKILLS = new Set(['boxing', 'boxe', 'judo', 'karate', 'carate']);

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
    parries: parryOptions(stats, attacks, warnings),
    block: stats.block.value ?? null,
    character,
  };
  return { combatant, warnings };
}

function diceNotation(count: number, adds: number): string {
  return `${count}d${adds > 0 ? `+${adds}` : adds < 0 ? String(adds) : ''}`;
}

type SkillRef = { readonly name: string; readonly level: number };

/** A skill by its full name ("Machado/Maça") or by any one "/"-separated part of it ("Machado"). */
function findSkill(stats: CombatStats, skillName: string): SkillRef | undefined {
  const wanted = normalize(skillName);
  return stats.skills.find((skill) => {
    const name = normalize(skill.name);
    return name === wanted || name.split('/').some((part) => part.trim() === wanted);
  });
}

/**
 * The skill for a weapon: the explicit mapping if there is one, else a skill named like
 * the weapon (in full, or by one "/"-separated part). Only if none does, a skill whose
 * name starts the weapon's ("Espada" for "Espada larga"), so a longer, more exact skill
 * is never shadowed by a shorter one that happens to come first on the sheet.
 */
function skillForWeapon(stats: CombatStats, weaponName: string, overrides: Readonly<Record<string, string>>): SkillRef | undefined {
  if (Object.hasOwn(overrides, weaponName)) return findSkill(stats, overrides[weaponName]!);
  const exact = findSkill(stats, weaponName);
  if (exact !== undefined) return exact;
  const wanted = normalize(weaponName);
  return stats.skills.find((skill) =>
    normalize(skill.name)
      .split('/')
      .some((part) => wanted.startsWith(`${part.trim()} `)),
  );
}

/** The Lance skill is for fighting from horseback (Basic Set p.204), and mounted combat isn't modelled. */
const MOUNTED_SKILLS = new Set(['lance', 'lanca']);

function meleeAttacks(stats: CombatStats, overrides: Readonly<Record<string, string>>, warnings: string[]): AttackOption[] {
  const attacks: AttackOption[] = [];
  for (const weapon of stats.weapons.melee) {
    const found = skillForWeapon(stats, weapon.name, overrides);
    if (found === undefined) {
      warnings.push(
        Object.hasOwn(overrides, weapon.name)
          ? `Weapon "${weapon.name}" is mapped to skill "${overrides[weapon.name]}", which ${stats.name} doesn't have`
          : `No skill found for weapon "${weapon.name}"; pass weaponSkills to map it`,
      );
      continue;
    }
    if (MOUNTED_SKILLS.has(normalize(found.name))) {
      warnings.push(`Weapon "${weapon.name}" uses ${found.name}, which is for mounted combat (p.204), not modelled yet`);
      continue;
    }
    const skill = found.level;
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
        weapon: weapon.name,
        strike: mode.base === 'thrust' || mode.base === 'swing' ? mode.base : null,
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
 * A punch (Basic Set p.271: thr-1 cr). Brawling at DX+2 or better adds +1 per die
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
      weapon: null,
      strike: 'thrust',
    },
  ];
}

/**
 * Parries (Basic Set pp.376-377). Each melee weapon the fighter can attack with parries at
 * 3 + half its skill plus the weapon's parry modifier, unless its parry is "No". A fighter
 * without melee weapons parries bare-handed at 3 + half its best Boxing, Brawling, Judo or
 * Karate, or DX if that is higher. (Whether a hand is free isn't tracked, so a fighter with
 * weapons never gets the bare-handed parry.)
 */
function parryOptions(stats: CombatStats, attacks: readonly AttackOption[], warnings: string[]): ParryOption[] {
  const parries: ParryOption[] = [];
  for (const weapon of stats.weapons.melee) {
    const skill = attacks.find((attack) => attack.weapon === weapon.name)?.skill;
    if (skill === undefined || parries.some((parry) => parry.id === weapon.name)) continue;
    if (!weapon.parry) {
      warnings.push(`Weapon "${weapon.name}" has no parry on the sheet, so it can't parry`);
      continue;
    }
    if (weapon.parry.modifier === null || weapon.parry.modifier === undefined) continue; // "No": can't parry
    const fencing = /F/i.test(weapon.parry.notation);
    parries.push({
      id: weapon.name,
      name: weapon.name,
      value: 3 + Math.floor(skill / 2) + weapon.parry.modifier,
      unbalanced: weapon.parry.unbalanced ?? /U/i.test(weapon.parry.notation),
      fencing,
      unarmed: false,
      retreatBonus: fencing ? 3 : 1,
    });
  }

  if (stats.weapons.melee.length === 0) {
    const skill = stats.skills
      .filter((candidate) => BARE_HAND_PARRY_SKILLS.has(normalize(candidate.name)))
      .reduce<{ name: string; level: number } | undefined>((best, candidate) => (!best || candidate.level > best.level ? candidate : best), undefined);
    const usesSkill = skill !== undefined && skill.level > stats.attributes.dx;
    const level = usesSkill ? skill.level : stats.attributes.dx;
    parries.push({
      id: 'bare-hands',
      name: 'Bare hands',
      value: 3 + Math.floor(level / 2),
      unbalanced: false,
      fencing: false,
      unarmed: true,
      retreatBonus: usesSkill && MOBILE_PARRY_SKILLS.has(normalize(skill.name)) ? 3 : 1,
    });
  }
  return parries;
}
