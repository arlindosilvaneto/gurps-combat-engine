import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runCli } from '../src/cli/app.js';
import { describeRoll, describeTurn, statusTable } from '../src/cli/format.js';
import type { CliIO, Choice, Prompter } from '../src/cli/io.js';
import { addToRoster, npcEntries, parseNpcSpec, parseSheetSpec, sheetEntry, sidesOf, type RosterEntry } from '../src/cli/roster.js';
import { createCombat, createDiceManager, npcCombatant, seededSource, type DefenseChoice } from '../src/index.js';
import { play } from './fixtures.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.resolve('@gurps-sheet/character/package.json'))), 'examples');
/** Rurik (players) and Fenrir (enemies), loaded from the sheet library's example files like a user would. */
const rurikVsFenrir = (): RosterEntry[] =>
  addToRoster([], [sheetEntry(join(EXAMPLES, 'rurik.json'), 'players'), sheetEntry(join(EXAMPLES, 'jotun.json'), 'enemies')]);

/**
 * One expected prompt: the message must match, and the answer is either a value (which must be
 * one of the enabled choices, for select and checkbox) or a function that picks from the choices.
 */
type Step = { readonly ask: RegExp; readonly answer: unknown | ((choices: readonly Choice<unknown>[]) => unknown) };

function scripted(steps: Step[]): CliIO & { output: string[]; remaining: () => number } {
  const queue = [...steps];
  const output: string[] = [];
  const next = (message: string, choices?: readonly Choice<unknown>[]) => {
    const step = queue.shift();
    assert.ok(step, `Unexpected prompt: "${message}"`);
    assert.match(message, step.ask, `Prompt "${message}" doesn't match ${step.ask}`);
    const answer = typeof step.answer === 'function' ? (step.answer as (c: readonly Choice<unknown>[]) => unknown)(choices ?? []) : step.answer;
    if (choices) {
      const enabled = choices.filter((c) => !c.disabled).map((c) => c.value);
      const picks = Array.isArray(answer) && !choices.some((c) => Array.isArray(c.value)) ? answer : [answer];
      for (const pick of picks) assert.ok(enabled.some((value) => isDeepStrictEqual(value, pick)), `"${JSON.stringify(pick)}" isn't an enabled choice for "${message}"`);
    }
    return answer;
  };
  const prompt: Prompter = {
    select: async (message, choices) => next(message, choices) as never,
    checkbox: async (message, choices) => next(message, choices) as never,
    input: async (message) => next(message) as string,
    number: async (message) => next(message) as number,
    confirm: async (message) => next(message) as boolean,
  };
  return { prompt, print: (text) => output.push(text), output, remaining: () => queue.length };
}


test('an all-AI fight set up from the menus runs to the end, then quits', async () => {
  const io = scripted([
    { ask: /What next\?/, answer: 'npc' },
    { ask: /adventure style/, answer: 'fantasy' },
    { ask: /Which NPC/, answer: 'fantasy-mercenary-knight' },
    { ask: /How many/, answer: 1 },
    { ask: /Which side/, answer: 'heroes' },
    { ask: /What next\?/, answer: 'npc' },
    { ask: /adventure style/, answer: 'fantasy' },
    { ask: /Which NPC/, answer: 'fantasy-town-guard' },
    { ask: /How many/, answer: 2 },
    { ask: /Which side/, answer: 'watch' },
    { ask: /What next\?/, answer: 'start' },
    { ask: /Which sides do you control/, answer: [] },
    { ask: /The fight is over/, answer: 'quit' },
  ]);
  await runCli(io, { seed: 7 });
  assert.equal(io.remaining(), 0);
  const text = io.output.join('\n');
  assert.match(text, /Seed 7 \(pass --seed 7/);
  assert.match(text, /Lance.*mounted combat/, 'the lance warning is shown when the knight is added');
  assert.match(text, /the fight is over\. (Side "(heroes|watch)" wins|Nobody is left standing)\./);
  assert.match(text, /Round 1 · /);
});

test('"Start the fight" is disabled until two sides have fighters', async () => {
  const io = scripted([
    {
      ask: /What next\?/,
      answer: (choices: readonly Choice<unknown>[]) => {
        assert.equal(choices.find((c) => c.value === 'start')?.disabled, 'needs fighters on two sides');
        return 'quit';
      },
    },
  ]);
  await runCli(io, { seed: 1 });
  assert.equal(io.remaining(), 0);
});

/** The first seed for which Fenrir's opening punch at Rurik does what `wanted` asks. */
function seedWhere(wanted: (status: 'miss' | 'awaiting-defense' | 'other') => boolean): number {
  for (let seed = 1; seed < 500; seed += 1) {
    const combat = createCombat(rurikVsFenrir().map((e) => e.combatant), { dice: createDiceManager({ source: seededSource(seed) }) });
    const step = combat.takeTurn({ maneuver: 'attack', attackId: 'punch', targetId: 'rurik-bjornsson' });
    const status = step.status === 'awaiting-defense' ? step.status : step.result.attack?.outcome === 'miss' ? 'miss' : 'other';
    if (wanted(status)) return seed;
  }
  throw new Error('no such seed below 500');
}

test('a player-controlled fighter edits modifiers and takes a turn through the menus', async () => {
  // A seed where the AI's Fenrir (who acts first, and can only punch Rurik) misses, so the first prompt is Rurik's turn.
  const seed = seedWhere((status) => status === 'miss');
  const io = scripted([
    { ask: /What next\?/, answer: 'start' }, // preloaded fighters still open the setup screen first
    { ask: /Which sides do you control/, answer: ['players'] },
    { ask: /Rurik Bjornsson's turn/, answer: 'modifiers' },
    { ask: /Modifiers:/, answer: 'add' },
    { ask: /For whom/, answer: 'rurik-bjornsson' },
    { ask: /What is it/, answer: 'Rage' },
    { ask: /Modifier/, answer: 1 },
    { ask: /Applies to/, answer: ['attack'] },
    { ask: /Rurik Bjornsson's turn/, answer: 'turn' },
    { ask: /Which maneuver/, answer: 'attack' },
    { ask: /With which attack/, answer: 'Machado#1' },
    { ask: /Attack whom/, answer: 'fenrir' },
  ]);
  // The script ends after Rurik's attack; the next prompt is beyond it, which is exactly the rejection expected.
  await assert.rejects(runCli(io, { seed, roster: rurikVsFenrir() }), /Unexpected prompt/);
  assert.equal(io.remaining(), 0, 'every scripted answer was used');
  const text = io.output.join('\n');
  assert.match(text, /Fenrir attacks Rurik Bjornsson with Punch: rolled \d+ vs 14: (failure|critical failure)\.\n  Miss\./);
  assert.match(text, /mods: Rage \+1 \(attack\)/, 'the modifier shows in the status table');
  assert.match(text, /Rurik Bjornsson attacks Fenrir with Machado: rolled \d+ vs 14 \(13\+1\)/, 'and applies to the attack roll');
});

test('the defense prompt offers every legal defense with its number, and the choice is used', async () => {
  // A seed where Fenrir's opening punch hits Rurik, so Rurik is asked to defend.
  const roster = rurikVsFenrir();
  const seed = seedWhere((status) => status === 'awaiting-defense');
  // The AI's only option is to punch Rurik (its one attack, its one target), so it opens the same way.
  let offered: string[] = [];
  const block: DefenseChoice = { kind: 'block', retreat: false };
  const io = scripted([
    { ask: /What next\?/, answer: 'start' }, // preloaded fighters still open the setup screen first
    { ask: /Which sides do you control/, answer: ['players'] },
    {
      ask: /Fenrir hits Rurik Bjornsson with Punch .*How does Rurik Bjornsson defend/,
      answer: (choices: readonly Choice<unknown>[]) => {
        offered = choices.map((c) => c.name);
        return block;
      },
    },
  ]);
  await assert.rejects(runCli(io, { seed, roster }), /Unexpected prompt/);
  assert.deepEqual(offered, [
    'Dodge: roll 9 or less',
    'Parry (Machado): roll 9 or less',
    'Block: roll 10 or less',
    'Dodge + retreat: roll 12 or less',
    'Parry (Machado) + retreat: roll 10 or less',
    'Block + retreat: roll 11 or less',
    'No defense',
  ]);
  assert.match(io.output.join('\n'), /Rurik Bjornsson blocks: rolled \d+ vs 10/);
});

test('--auto runs the whole fight from command-line specs, and needs two sides', async () => {
  const roster = addToRoster([], [...npcEntries('fantasy-mercenary-knight', 'heroes', 1), ...npcEntries('fantasy-town-guard', 'watch', 2)]);
  const io = scripted([]);
  await runCli(io, { seed: 7, roster, auto: true });
  assert.match(io.output.join('\n'), /the fight is over/);
  await assert.rejects(runCli(scripted([]), { seed: 7, roster: roster.slice(0, 1), auto: true }), /needs fighters on at least two sides/);
});

test('an all-AI fight that can\'t end stops as a stalemate', async () => {
  const roster = addToRoster([], [...npcEntries('modern-street-thug', 'a', 1), ...npcEntries('science-fiction-space-marine', 'b', 1)]);
  const io = scripted([]);
  await runCli(io, { seed: 1, roster, auto: true, maxTurns: 10 });
  const text = io.output.join('\n');
  if (!/the fight is over/.test(text)) assert.match(text, /No winner after 10 turns: stopping here as a stalemate/);
});

test('roster: duplicate NPCs get distinct ids and names, and sides are listed once', () => {
  let roster = addToRoster([], npcEntries('fantasy-town-guard', 'watch', 1));
  roster = addToRoster(roster, npcEntries('fantasy-town-guard', 'watch', 1));
  const [first, second] = roster.map((e) => e.combatant);
  assert.notEqual(first!.id, second!.id);
  assert.notEqual(first!.name, second!.name);
  assert.deepEqual(sidesOf(roster), ['watch']);
  assert.doesNotThrow(() => createCombat([...roster.map((e) => e.combatant), npcCombatant('fantasy-thief', { side: 'x' }).combatant], { dice: createDiceManager() }));
});

test('roster: specs from the command line', () => {
  assert.deepEqual(parseNpcSpec('fantasy-town-guard:watch:3'), { npc: 'fantasy-town-guard', side: 'watch', count: 3 });
  assert.deepEqual(parseNpcSpec('fantasy-thief'), { npc: 'fantasy-thief', side: 'npcs', count: 1 });
  assert.throws(() => parseNpcSpec('fantasy-thief:x:0'), /at least 1/);
  assert.deepEqual(parseSheetSpec('./heroes/rurik.json:players'), { path: './heroes/rurik.json', side: 'players' });
  assert.deepEqual(parseSheetSpec('./heroes/rurik.json'), { path: './heroes/rurik.json', side: 'players' });
  assert.deepEqual(parseSheetSpec('C:\\chars\\rurik.json'), { path: 'C:\\chars\\rurik.json', side: 'players' });
});

test('roster: a missing or invalid sheet file gives a readable error', () => {
  assert.throws(() => sheetEntry('/no/such/file.json', 'x'), /Can't read "\/no\/such\/file\.json": no such file/);
  const bad = join(dirname(fileURLToPath(import.meta.url)), 'cli.test.ts'); // not JSON at all
  assert.throws(() => sheetEntry(bad, 'x'), /is not a usable gurps-character file/);
});

test('format: rolls and turns read as sentences, with every number', () => {
  const combat = createCombat(
    [npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant, npcCombatant('fantasy-town-guard', { side: 'b' }).combatant],
    { dice: createDiceManager({ source: seededSource(5) }) },
  );
  const result = play(combat, { maneuver: 'attack', attackId: 'Broadsword#1', targetId: 'fantasy-town-guard' }, { kind: 'dodge', retreat: true });
  const text = describeTurn(result, combat.view());
  assert.match(text, /^Round 1 · Ser Gareth of Highmoor attacks Aldric Brenn with Broadsword \(swing\): rolled \d+ vs 16: /);
  assert.match(describeRoll(result.attack!.attackRoll), /^rolled \d+ vs 16: (critical )?(success|failure)$/);
  assert.match(statusTable(combat.view()), /Ser Gareth of Highmoor \[a\].*Dodge 9, Parry 11 \(Broadsword\), Parry 8 \(Dagger\), Block 10, DR 4/);
});

test('the real command: --help, --version, and a full --auto fight', () => {
  const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], { encoding: 'utf8' });
  assert.match(run('--help'), /Usage: gurps-combat \[options\]/);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  assert.equal(run('--version').trim(), pkg.version);
  const out = run('--auto', '--seed', '11', '--npc', 'fantasy-mercenary-knight:heroes', '--npc', 'fantasy-town-guard:watch:2');
  assert.match(out, /Seed 11/);
  assert.match(out, /the fight is over/);
  assert.throws(() => run('--auto', '--npc', 'fantasy-dragon:x'), /Unknown NPC "fantasy-dragon"/);
});
