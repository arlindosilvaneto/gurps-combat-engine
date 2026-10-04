/**
 * The maneuvers implemented so far. The Basic Set lists 13 (p.363); the rest
 * (Move, Aim, Feint, Wait, ...) are not modelled yet.
 */
export type Maneuver = 'do-nothing' | 'attack' | 'all-out-attack' | 'all-out-defense';

/** The three active defenses (Basic Set p.374). */
export type DefenseKind = 'dodge' | 'parry' | 'block';

export interface ManeuverEffects {
  /** Bonus to the attack roll. */
  readonly attackBonus: number;
  /** Bonus to the one active defense the actor chose, lasting until its next turn. */
  readonly defenseBonus: number;
  readonly canAttack: boolean;
  /** Whether the actor may make an active defense while this is its current maneuver. */
  readonly canDefend: boolean;
}

/**
 * Maneuver rules (Basic Set pp.364-366). The most recent maneuver governs the
 * actor's defenses until its next turn (p.363).
 */
export const MANEUVER_EFFECTS: Readonly<Record<Maneuver, ManeuverEffects>> = {
  // p.364. Also what anyone who hasn't acted yet counts as. (Being stunned is not modelled yet.)
  'do-nothing': { attackBonus: 0, defenseBonus: 0, canAttack: false, canDefend: true },
  // p.365: step and attack, any defense.
  attack: { attackBonus: 0, defenseBonus: 0, canAttack: true, canDefend: true },
  // p.365: the "Determined" option: +4 to hit, and no active defense at all until the next turn.
  'all-out-attack': { attackBonus: 4, defenseBonus: 0, canAttack: true, canDefend: false },
  // p.366: the "Increased Defense" option: +2 to one active defense of your choice (Dodge, Parry or Block).
  'all-out-defense': { attackBonus: 0, defenseBonus: 2, canAttack: false, canDefend: true },
};

export function isAttackManeuver(maneuver: Maneuver): maneuver is 'attack' | 'all-out-attack' {
  return MANEUVER_EFFECTS[maneuver].canAttack;
}
