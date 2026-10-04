#!/usr/bin/env node
// The `gurps-combat` command. Everything interactive lives in src/cli; the library never imports it.
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { runCli } from './app.js';
import { terminalIO } from './inquirer.js';
import { addToRoster, npcEntries, parseNpcSpec, parseSheetSpec, sheetEntry, type RosterEntry } from './roster.js';

const USAGE = `Usage: gurps-combat [options]

Sets up and runs a GURPS 4e melee fight in the terminal. With no options it opens the
setup screen, where you add NPCs or character files and choose which sides you control.

Options:
  --npc <id>[:<side>[:<count>]]   Add NPCs from @gurps-sheet/npcs (repeatable), e.g. fantasy-town-guard:watch:3
  --sheet <file>[:<side>]         Add a character from a gurps-character JSON file (repeatable)
  --auto                          Let the AI play every side, print the fight and exit
  --seed <n>                      Seed the dice to replay a fight exactly
  -h, --help                      Show this help
  -v, --version                   Show the version
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      npc: { type: 'string', multiple: true },
      sheet: { type: 'string', multiple: true },
      auto: { type: 'boolean' },
      seed: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    // ../../package.json from both src/cli (development) and dist/cli (installed).
    console.log(createRequire(import.meta.url)('../../package.json').version);
    return 0;
  }

  const seed = values.seed === undefined ? randomInt(1, 2 ** 31 - 1) : Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be a whole number, got "${values.seed}"`);

  let roster: RosterEntry[] = [];
  for (const spec of values.npc ?? []) {
    const { npc, side, count } = parseNpcSpec(spec);
    roster = addToRoster(roster, npcEntries(npc, side, count));
  }
  for (const spec of values.sheet ?? []) {
    const { path, side } = parseSheetSpec(spec);
    roster = addToRoster(roster, [sheetEntry(path, side)]);
  }

  await runCli(terminalIO, { seed, roster, auto: values.auto ?? false });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Ctrl+C inside a prompt is a normal way out, not a crash.
    if (error instanceof Error && error.name === 'ExitPromptError') process.exit(130);
    console.error(`gurps-combat: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
