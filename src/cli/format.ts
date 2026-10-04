import { combatStats, type GurpsCharacter } from '@gurps-sheet/character';
import type { CombatView, FighterView } from '../combat/combat.js';
import type { DefenseKind } from '../combat/maneuvers.js';
import type { DefenseChoice, DefenseOption, TurnResult } from '../combat/types.js';
import type { SuccessRollResult } from '../rules/success-roll.js';

const OUTCOME: Record<SuccessRollResult['outcome'], string> = {
  'critical-success': 'critical success',
  success: 'success',
  failure: 'failure',
  'critical-failure': 'critical failure',
};

const MANEUVER: Record<FighterView['maneuver'], string> = {
  'do-nothing': 'Do Nothing',
  attack: 'Attack',
  'all-out-attack': 'All-Out Attack',
  'all-out-defense': 'All-Out Defense',
};

const DEFENSE: Record<DefenseKind, string> = { dodge: 'Dodge', parry: 'Parry', block: 'Block' };

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** "rolled 9 vs 14 (16-2): success" */
export function describeRoll(roll: SuccessRollResult): string {
  const breakdown = roll.modifier === 0 ? '' : ` (${roll.baseSkill}${signed(roll.modifier)})`;
  return `rolled ${roll.roll.total} vs ${roll.effectiveSkill}${breakdown}: ${OUTCOME[roll.outcome]}`;
}

export function maneuverName(fighter: Pick<FighterView, 'maneuver' | 'increased'>): string {
  return fighter.maneuver === 'all-out-defense' && fighter.increased
    ? `All-Out Defense (+2 ${DEFENSE[fighter.increased]})`
    : MANEUVER[fighter.maneuver];
}

const defenseVerb = (choice: DefenseChoice, parryName: (id: string) => string): string => {
  if (choice.kind === 'none') return 'takes the blow';
  let verb: string;
  if (choice.kind === 'parry') verb = `parries with ${parryName(choice.parryId)}`;
  else verb = choice.kind === 'dodge' ? 'dodges' : 'blocks';
  return choice.retreat ? `${verb}, retreating` : verb;
};

/** One turn as a few sentences, with every roll. Read HP from `view`, taken after the turn. */
export function describeTurn(result: TurnResult, view: CombatView): string {
  const fighter = (id: string) => view.fighters.find((candidate) => candidate.id === id);
  const name = (id: string) => fighter(id)?.name ?? id;
  const actor = fighter(result.actorId);
  const head = `Round ${result.round} · ${name(result.actorId)}`;

  if (!result.attack) {
    if (result.maneuver === 'all-out-defense' && result.increase) return `${head} takes All-Out Defense: +2 ${DEFENSE[result.increase]} until their next turn.`;
    return `${head} does nothing.`;
  }

  const attack = result.attack;
  const target = fighter(attack.targetId);
  const attackName = actor?.attacks.find((option) => option.id === attack.attackId)?.name ?? attack.attackId;
  const allOut = result.maneuver === 'all-out-attack' ? ' (All-Out Attack)' : '';
  const lines = [`${head} attacks ${name(attack.targetId)} with ${attackName}${allOut}: ${describeRoll(attack.attackRoll)}.`];

  if (attack.outcome === 'miss') return [...lines, '  Miss.'].join('\n');
  if (attack.criticalHit) lines.push('  Critical hit: no defense is possible.');
  if (attack.defense) {
    const parryName = (id: string) => target?.parries.find((parry) => parry.id === id)?.name ?? id;
    const roll = attack.defense.roll ? `: ${describeRoll(attack.defense.roll)}` : '';
    lines.push(`  ${name(attack.targetId)} ${defenseVerb(attack.defense.choice, parryName)}${roll}.`);
  } else if (!attack.criticalHit) {
    lines.push(`  ${name(attack.targetId)} can't defend.`);
  }
  if (attack.outcome === 'defended') return [...lines, '  Defended.'].join('\n');

  const damage = attack.damage!;
  const { injury } = damage;
  lines.push(
    `  Hit! ${damage.roll.notation} = ${injury.basic} ${damage.type}, DR ${injury.dr}: ${injury.injury} HP` +
      (target ? `. ${target.name} is at ${target.hp.current}/${target.hp.max} HP${target.defeated ? ' and is down' : ''}.` : '.'),
  );
  if (attack.selfInjury && attack.selfInjury.injury > 0 && actor) {
    lines.push(`  ${actor.name} hurts themselves on the armor: ${attack.selfInjury.injury} HP (${actor.hp.current}/${actor.hp.max}).`);
  }
  return lines.join('\n');
}

/** "Parry (Broadsword) + retreat: roll 12 or less" */
export function describeDefenseOption(option: DefenseOption): string {
  return option.target === null ? option.label : `${option.label}: roll ${option.target} or less`;
}

function defensesOf(fighter: FighterView): string {
  const parts = [`Dodge ${fighter.dodge}`];
  for (const parry of fighter.parries) parts.push(`Parry ${parry.value} (${parry.name})`);
  if (fighter.block !== null) parts.push(`Block ${fighter.block}`);
  return parts.join(', ');
}

/** The table shown before each decision: every fighter's HP, maneuver, defenses and modifiers. */
export function statusTable(view: CombatView): string {
  const nameWidth = Math.max(...view.fighters.map((f) => f.name.length + f.side.length + 3));
  const header =
    view.status === 'finished'
      ? `Round ${view.round}: the fight is over. ${view.winner ? `Side "${view.winner}" wins.` : 'Nobody is left standing.'}`
      : `Round ${view.round}`;
  const rows = view.fighters.map((fighter) => {
    const marker = fighter.id === view.awaitingId ? '>' : ' ';
    const who = `${fighter.name} [${fighter.side}]`.padEnd(nameWidth);
    const hp = fighter.defeated ? 'DOWN'.padEnd(9) : `${fighter.hp.current}/${fighter.hp.max} HP`.padEnd(9);
    const modifiers = fighter.modifiers.length
      ? `  mods: ${fighter.modifiers.map((m) => `${m.label} ${signed(m.value)}${m.appliesTo.length ? ` (${m.appliesTo.join(', ')})` : ''}`).join('; ')}`
      : '';
    return ` ${marker} ${who}  ${hp}  ${maneuverName(fighter).padEnd(26)}  ${defensesOf(fighter)}, DR ${fighter.dr}${modifiers}`;
  });
  return [header, ...rows].join('\n');
}

/** A short character sheet for the "view a sheet" screen. */
export function sheetSummary(sheet: GurpsCharacter, fighter: FighterView): string {
  const stats = combatStats(sheet);
  const { st, dx, iq, ht } = stats.attributes;
  const skills = stats.skills.map((skill) => `${skill.name} ${skill.level}`).join(', ');
  return [
    `${stats.name} [${fighter.side}]`,
    `  HP ${stats.hp.current}/${stats.hp.max}  FP ${stats.fp.current}/${stats.fp.max}`,
    `  ST ${st}  DX ${dx}  IQ ${iq}  HT ${ht}  Will ${stats.will}  Per ${stats.perception}`,
    `  Basic Speed ${stats.basicSpeed}  Basic Move ${stats.basicMove}  Damage thr ${stats.damage.thrust.notation}, sw ${stats.damage.swing.notation}`,
    `  ${defensesOf(fighter)}, DR ${fighter.dr} (torso)`,
    `  Attacks: ${fighter.attacks.map((a) => `${a.name} (skill ${a.skill}, ${a.damage.notation} ${a.damage.type})`).join('; ') || 'none'}`,
    `  Skills: ${skills || 'none'}`,
  ].join('\n');
}
