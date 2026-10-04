import { listNpcs } from '@gurps-sheet/npcs';
import { bestDefense, bestExpectedInjury } from '../combat/automation.js';
import { createCombat, type Combat, type CombatView, type FighterView } from '../combat/combat.js';
import type { DefenseKind } from '../combat/maneuvers.js';
import { isAttackAction, type TurnAction } from '../combat/types.js';
import { createDiceManager } from '../dice/dice-manager.js';
import { seededSource } from '../dice/sources.js';
import { describeDefenseOption, describeTurn, sheetSummary, statusTable } from './format.js';
import type { CliIO } from './io.js';
import { addToRoster, npcEntries, sheetEntry, sidesOf, type RosterEntry } from './roster.js';

export interface CliOptions {
  /** Seed for every roll, so a fight can be replayed. */
  readonly seed: number;
  /** Fighters added from the command line, before the setup screen. */
  readonly roster?: readonly RosterEntry[];
  /** Play the whole fight with the AI and exit, without any prompts. */
  readonly auto?: boolean;
  /** Turns after which an all-AI fight is stopped as a stalemate. */
  readonly maxTurns?: number;
}

type AfterFight = 'restart' | 'setup' | 'quit';

/** Runs the CLI: setup, then fights, until the user quits. */
export async function runCli(io: CliIO, { seed, roster: preset = [], auto = false, maxTurns = 500 }: CliOptions): Promise<void> {
  io.print(`GURPS combat engine. Seed ${seed} (pass --seed ${seed} to replay these rolls).`);
  for (const entry of preset) reportWarnings(io, entry);

  if (auto) {
    if (sidesOf(preset).length < 2) throw new Error('--auto needs fighters on at least two sides (use --npc or --sheet)');
    await fight(io, newCombat(preset, seed), new Set(), maxTurns, false);
    return;
  }

  let roster: RosterEntry[] = [...preset];
  for (;;) {
    const ready = await setup(io, roster);
    if (!ready) return;
    roster = ready;
    const controlled = new Set(
      await io.prompt.checkbox(
        'Which sides do you control? (choose none to let the AI play everyone)',
        sidesOf(roster).map((side) => ({ name: side, value: side })),
      ),
    );
    const combat = newCombat(roster, seed);
    for (;;) {
      const next = await fight(io, combat, controlled, maxTurns, true);
      if (next === 'quit') return;
      if (next === 'setup') break;
      combat.reset();
      io.print('The fight starts over.');
    }
  }
}

const newCombat = (roster: readonly RosterEntry[], seed: number): Combat =>
  createCombat(
    roster.map((entry) => entry.combatant),
    { dice: createDiceManager({ source: seededSource(seed) }) },
  );

function reportWarnings(io: CliIO, entry: RosterEntry): void {
  for (const warning of entry.warnings) io.print(`  ! ${entry.combatant.name}: ${warning}`);
}

// ---------------- setup ----------------

/** The setup screen. Returns the roster to fight with, or null to quit. */
async function setup(io: CliIO, start: readonly RosterEntry[]): Promise<RosterEntry[] | null> {
  let roster = [...start];
  for (;;) {
    io.print(rosterList(roster));
    const ready = sidesOf(roster).length >= 2;
    const choice = await io.prompt.select('What next?', [
      { name: 'Add NPCs from the library', value: 'npc' as const },
      { name: 'Add a character from a file', value: 'sheet' as const },
      { name: 'Remove a fighter', value: 'remove' as const, disabled: roster.length === 0 },
      { name: 'Start the fight', value: 'start' as const, disabled: ready ? false : 'needs fighters on two sides' },
      { name: 'Quit', value: 'quit' as const },
    ]);
    if (choice === 'quit') return null;
    if (choice === 'start') return roster;
    if (choice === 'remove') {
      const id = await io.prompt.select('Remove which fighter?', roster.map((e) => ({ name: `${e.combatant.name} [${e.combatant.side}]`, value: e.combatant.id })));
      roster = roster.filter((e) => e.combatant.id !== id);
      continue;
    }
    const added = choice === 'npc' ? await chooseNpcs(io) : await chooseSheet(io);
    if (added.length) {
      roster = addToRoster(roster, added);
      for (const entry of roster.slice(-added.length)) reportWarnings(io, entry);
    }
  }
}

function rosterList(roster: readonly RosterEntry[]): string {
  if (roster.length === 0) return '\nNo fighters yet.';
  const lines = sidesOf(roster).map((side) => {
    const fighters = roster.filter((e) => e.combatant.side === side);
    return `  ${side}: ${fighters.map((e) => `${e.combatant.name}${e.combatant.attacks.length ? '' : ' (no usable attack)'}`).join(', ')}`;
  });
  return ['\nFighters:', ...lines].join('\n');
}

async function chooseNpcs(io: CliIO): Promise<RosterEntry[]> {
  const npcs = listNpcs();
  const styles = [...new Set(npcs.map((npc) => npc.style))];
  const style = await io.prompt.select('Which adventure style?', styles.map((s) => ({ name: s, value: s })));
  const npc = await io.prompt.select(
    'Which NPC?',
    npcs
      .filter((candidate) => candidate.style === style)
      .map((candidate) => ({ name: `${candidate.name}: ${candidate.role}`, value: candidate.id, description: `${candidate.threat}, ${candidate.points} points` })),
  );
  const count = await io.prompt.number('How many?', { default: 1, min: 1, max: 20 });
  const side = await io.prompt.input('Which side are they on?', { default: 'enemies', validate: (v) => (v.trim() ? true : 'Give the side a name') });
  return npcEntries(npc, side.trim(), count);
}

async function chooseSheet(io: CliIO): Promise<RosterEntry[]> {
  const path = await io.prompt.input('Path to the gurps-character JSON file:', { validate: (v) => (v.trim() ? true : 'Enter a path') });
  const side = await io.prompt.input('Which side are they on?', { default: 'players', validate: (v) => (v.trim() ? true : 'Give the side a name') });
  try {
    return [sheetEntry(path.trim(), side.trim())];
  } catch (error) {
    io.print(`  ! ${(error as Error).message}`);
    return [];
  }
}

// ---------------- the fight ----------------

const fighterIn = (view: CombatView, id: string | null): FighterView | undefined => view.fighters.find((f) => f.id === id);

/**
 * Plays the fight: the AI acts for every side not in `controlled`, and the user decides
 * for the rest. Returns what to do once it ends.
 */
async function fight(io: CliIO, combat: Combat, controlled: ReadonlySet<string>, maxTurns: number, interactive: boolean): Promise<AfterFight> {
  io.print(`\n${statusTable(combat.view())}`);
  let turns = 0;
  for (;;) {
    const view = combat.view();
    if (view.status === 'finished') {
      io.print(`\n${statusTable(view)}`);
      if (!interactive) return 'quit';
      return io.prompt.select('The fight is over. What next?', [
        { name: 'Fight again with the same fighters', value: 'restart' as const },
        { name: 'Back to setup', value: 'setup' as const },
        { name: 'Quit', value: 'quit' as const },
      ]);
    }

    if (view.status === 'awaiting-defense') {
      const defender = fighterIn(view, view.awaitingId)!;
      const legal = combat.legalDefenses();
      const choice = controlled.has(defender.side) ? await chooseDefense(io, view, defender, legal) : bestDefense(view, legal);
      io.print(describeTurn(combat.defend(choice), combat.view()));
      continue;
    }

    const actor = fighterIn(view, view.currentId)!;
    if (!controlled.has(actor.side)) {
      if (controlled.size === 0 && turns >= maxTurns) {
        io.print(`\nNo winner after ${maxTurns} turns: stopping here as a stalemate.`);
        if (!interactive) return 'quit';
        return io.prompt.select('What next?', [
          { name: 'Fight again with the same fighters', value: 'restart' as const },
          { name: 'Back to setup', value: 'setup' as const },
          { name: 'Quit', value: 'quit' as const },
        ]);
      }
      turns += 1;
      const step = combat.takeTurn(bestExpectedInjury(view, combat.legalActions()));
      if (step.status === 'resolved') io.print(describeTurn(step.result, combat.view()));
      continue;
    }

    io.print(`\n${statusTable(view)}`);
    const next = await turnMenu(io, combat, actor);
    if (next) return next;
  }
}

/** The menu for a fighter the user controls. Returns a value only to leave the fight. */
async function turnMenu(io: CliIO, combat: Combat, actor: FighterView): Promise<AfterFight | undefined> {
  const choice = await io.prompt.select(`${actor.name}'s turn. What do you do?`, [
    { name: 'Take my turn', value: 'turn' as const },
    { name: 'Let the AI decide this turn', value: 'ai' as const },
    { name: 'Modifiers', value: 'modifiers' as const },
    { name: 'View a fighter\'s sheet', value: 'sheet' as const },
    { name: 'Restart the fight', value: 'restart' as const },
    { name: 'Back to setup', value: 'setup' as const },
    { name: 'Quit', value: 'quit' as const },
  ]);
  const view = combat.view();
  switch (choice) {
    case 'turn': {
      const action = await chooseAction(io, view, actor, combat.legalActions());
      if (action) {
        const step = combat.takeTurn(action);
        if (step.status === 'resolved') io.print(describeTurn(step.result, combat.view()));
      }
      return undefined;
    }
    case 'ai': {
      const step = combat.takeTurn(bestExpectedInjury(view, combat.legalActions()));
      if (step.status === 'resolved') io.print(describeTurn(step.result, combat.view()));
      return undefined;
    }
    case 'modifiers':
      await modifiersMenu(io, combat);
      return undefined;
    case 'sheet': {
      const id = await io.prompt.select('Whose sheet?', view.fighters.map((f) => ({ name: `${f.name} [${f.side}]`, value: f.id })));
      io.print(sheetSummary(combat.sheetOf(id), fighterIn(view, id)!));
      return undefined;
    }
    case 'restart':
      return (await io.prompt.confirm('Start this fight over from the beginning?', false)) ? 'restart' : undefined;
    case 'setup':
      return (await io.prompt.confirm('Leave this fight and go back to setup?', false)) ? 'setup' : undefined;
    case 'quit':
      return (await io.prompt.confirm('Quit?', false)) ? 'quit' : undefined;
  }
}

const DEFENSE_NAME: Record<DefenseKind, string> = { dodge: 'Dodge', parry: 'Parry', block: 'Block' };

/** Maneuver, then attack and target or the defense to raise. Undefined if the user goes back. */
async function chooseAction(io: CliIO, view: CombatView, actor: FighterView, legal: readonly TurnAction[]): Promise<TurnAction | undefined> {
  const has = (maneuver: TurnAction['maneuver']) => legal.some((action) => action.maneuver === maneuver);
  const maneuver = await io.prompt.select('Which maneuver?', [
    { name: 'Attack', value: 'attack' as const, disabled: has('attack') ? false : 'nothing to attack with' },
    { name: 'All-Out Attack', value: 'all-out-attack' as const, description: '+4 to hit, but no defense until your next turn', disabled: !has('all-out-attack') },
    { name: 'All-Out Defense', value: 'all-out-defense' as const, description: '+2 to one defense until your next turn' },
    { name: 'Do Nothing', value: 'do-nothing' as const },
    { name: 'Back', value: 'back' as const },
  ]);
  if (maneuver === 'back') return undefined;
  if (maneuver === 'do-nothing') return { maneuver };

  if (maneuver === 'all-out-defense') {
    const scores: Record<DefenseKind, number> = {
      dodge: actor.dodge,
      parry: Math.max(-Infinity, ...actor.parries.map((p) => p.value)),
      block: actor.block ?? -Infinity,
    };
    const increase = await io.prompt.select(
      'Raise which defense by +2?',
      legal.flatMap((action) =>
        action.maneuver === 'all-out-defense'
          ? [{ name: `${DEFENSE_NAME[action.increase]} (${scores[action.increase]} -> ${scores[action.increase] + 2})`, value: action.increase }]
          : [],
      ),
    );
    return { maneuver, increase };
  }

  const attacks = legal.filter(isAttackAction).filter((action) => action.maneuver === maneuver);
  const attackId = await io.prompt.select(
    'With which attack?',
    actor.attacks
      .filter((option) => attacks.some((action) => action.attackId === option.id))
      .map((option) => ({ name: `${option.name}: skill ${option.skill}, ${option.damage.notation} ${option.damage.type}`, value: option.id })),
  );
  const targetId = await io.prompt.select(
    'Attack whom?',
    attacks
      .filter((action) => action.attackId === attackId)
      .map((action) => {
        const target = fighterIn(view, action.targetId)!;
        return { name: `${target.name} [${target.side}]: ${target.hp.current}/${target.hp.max} HP, DR ${target.dr}`, value: target.id };
      }),
  );
  return { maneuver, attackId, targetId };
}

async function chooseDefense(io: CliIO, view: CombatView, defender: FighterView, legal: ReturnType<Combat['legalDefenses']>) {
  const pending = view.pending!;
  const attacker = fighterIn(view, pending.actorId)!;
  const attackName = attacker.attacks.find((a) => a.id === pending.attackId)?.name ?? pending.attackId;
  return io.prompt.select(
    `${attacker.name} hits ${defender.name} with ${attackName} (rolled ${pending.attackRoll.roll.total} vs ${pending.attackRoll.effectiveSkill}). How does ${defender.name} defend?`,
    legal.map((option) => ({ name: describeDefenseOption(option), value: option.choice })),
  );
}

const SCOPES = [
  { name: 'Every roll', value: [] as string[] },
  { name: 'Attack rolls', value: ['attack'] },
  { name: 'Every defense', value: ['defense'] },
  { name: 'Dodge only', value: ['dodge'] },
  { name: 'Parry only', value: ['parry'] },
  { name: 'Block only', value: ['block'] },
] as const;

async function modifiersMenu(io: CliIO, combat: Combat): Promise<void> {
  const view = combat.view();
  const action = await io.prompt.select('Modifiers:', [
    { name: 'Add a modifier', value: 'add' as const },
    { name: 'Change a modifier', value: 'edit' as const, disabled: !view.fighters.some((f) => f.modifiers.length) },
    { name: 'Remove a modifier', value: 'remove' as const, disabled: !view.fighters.some((f) => f.modifiers.length) },
    { name: 'Back', value: 'back' as const },
  ]);
  if (action === 'back') return;

  if (action === 'add') {
    const fighterId = await io.prompt.select('For whom?', view.fighters.map((f) => ({ name: `${f.name} [${f.side}]`, value: f.id })));
    const label = await io.prompt.input('What is it? (e.g. "Dim light")', { validate: (v) => (v.trim() ? true : 'Give it a name') });
    const value = await io.prompt.number('Modifier (e.g. -2 or 1):', { default: -1, min: -20, max: 20 });
    const appliesTo = await io.prompt.select('Applies to:', SCOPES.map((scope) => ({ name: scope.name, value: scope.value })));
    combat.addModifier(fighterId, { label: label.trim(), value, appliesTo: [...appliesTo] });
    return;
  }

  const holders = view.fighters.filter((f) => f.modifiers.length);
  const fighterId = await io.prompt.select('Whose modifier?', holders.map((f) => ({ name: `${f.name} [${f.side}]`, value: f.id })));
  const modifiers = fighterIn(view, fighterId)!.modifiers;
  const modifierId = await io.prompt.select('Which modifier?', modifiers.map((m) => ({ name: `${m.label} ${m.value >= 0 ? '+' : ''}${m.value}`, value: m.id })));
  if (action === 'remove') {
    combat.removeModifier(fighterId, modifierId);
    return;
  }
  const value = await io.prompt.number('New value:', { default: modifiers.find((m) => m.id === modifierId)!.value, min: -20, max: 20 });
  combat.updateModifier(fighterId, modifierId, { value });
}
