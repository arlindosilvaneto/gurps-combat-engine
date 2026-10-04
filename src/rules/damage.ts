import type { DiceManager, DiceRoll } from '../dice/dice-manager.js';

/**
 * Damage types that injure HP. Fatigue, toxic, and the special types (tbb, aff, spec)
 * need rules this engine doesn't have yet and are not modelled.
 */
export type WoundingType = 'cr' | 'cut' | 'imp' | 'pi-' | 'pi' | 'pi+' | 'pi++' | 'burn' | 'cor';

/** Wounding modifier by damage type (Basic Set p.379). */
const WOUNDING_MULTIPLIER: Readonly<Record<WoundingType, number>> = {
  'pi-': 0.5,
  burn: 1,
  cor: 1,
  cr: 1,
  pi: 1,
  cut: 1.5,
  'pi+': 1.5,
  imp: 2,
  'pi++': 2,
};

export function isWoundingType(type: string | undefined): type is WoundingType {
  return type !== undefined && Object.hasOwn(WOUNDING_MULTIPLIER, type);
}

export function woundingMultiplier(type: WoundingType): number {
  return WOUNDING_MULTIPLIER[type];
}

export interface DamageRoll {
  readonly roll: DiceRoll;
  /** The roll's total after the floor: 0 for crushing, 1 for every other type (p.378). */
  readonly basic: number;
}

/** Rolls damage such as "2d+1". A negative modifier can't push damage below 0 (crushing) or 1 (others). */
export function rollDamage(dice: DiceManager, notation: string, type: WoundingType): DamageRoll {
  const roll = dice.roll(notation);
  return { roll, basic: Math.max(roll.total, type === 'cr' ? 0 : 1) };
}

export interface InjuryResult {
  readonly basic: number;
  /** Damage Resistance applied (never negative). */
  readonly dr: number;
  /** Basic damage left after DR. */
  readonly penetrating: number;
  readonly multiplier: number;
  /** HP the target loses. */
  readonly injury: number;
}

/**
 * Basic damage to injury (Basic Set p.378-379): subtract DR to get penetrating
 * damage, multiply by the wounding modifier, round down. Anything that penetrates
 * at all does at least 1 HP; nothing penetrating does none.
 */
export function resolveInjury({ basic, dr, type }: { basic: number; dr: number; type: WoundingType }): InjuryResult {
  const appliedDr = Math.max(0, dr);
  const penetrating = Math.max(0, basic - appliedDr);
  const multiplier = woundingMultiplier(type);
  const injury = penetrating > 0 ? Math.max(1, Math.floor(penetrating * multiplier)) : 0;
  return { basic, dr: appliedDr, penetrating, multiplier, injury };
}
