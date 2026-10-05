# @gurps-sheet/combat-engine

A combat engine for **GURPS 4th Edition**, written as a library. It takes characters in the [`gurps-character`](https://www.npmjs.com/package/@gurps-sheet/character) format, runs a fight by the Basic Set rules, and tells you exactly what happened: every roll, every modifier, every point of injury.

It is the core that other tools build on, such as a VTT bridge or a test harness, and it ships with **`gurps-combat`**, a command-line tool to set up and play fights in the terminal. The library itself has no user interface, no input/output and no global state, so the same fight runs identically in a terminal, a server or a unit test.

- **Written in TypeScript, shipped as ES modules** (`dist/`, with declarations and source maps). Requires Node ≥ 20.19.
- **Built on the sheet libraries.** Characters come from [`@gurps-sheet/character`](https://www.npmjs.com/package/@gurps-sheet/character), and ready-made NPCs from [`@gurps-sheet/npcs`](https://www.npmjs.com/package/@gurps-sheet/npcs). Both install with it.
- **Early version (0.3).** Melee combat with Dodge, Parry and Block, shock, major wounds and stun works end to end. See [What is and isn't implemented](#what-is-and-isnt-implemented) before relying on it.

## Goals

1. **Follow the rules.** Every rule cites its Basic Set page in the source, and the tests are tables of cases taken from those pages.
2. **One state machine for the whole fight.** The full state (turn order, round, maneuvers, HP, modifiers) lives in one place and can be reset or restarted at any time. Every change is a plain-data event, so the history can be logged as JSON.
3. **Reproducible by construction.** Every random outcome goes through one dice manager. Give it real randomness, a seed, or a script of exact die faces, and the same fight plays out the same way.
4. **Modifiers you can change mid-fight.** Add, edit or remove a situational modifier at any time. Later rolls change; rolls already made don't.
5. **Interactive or automated, on the same engine.** A person, a script or the built-in policy picks from `legalActions()`, and `takeTurn()` accepts exactly those actions.
6. **The engine owns combat conditions.** The sheet only stores current HP and FP. Shock, stun and unconsciousness belong to the fight, not to the character document, so a reset clears them.

## Install

```bash
npm install @gurps-sheet/combat-engine
```

That also installs `@gurps-sheet/character` and `@gurps-sheet/npcs`, which the engine depends on, and `@inquirer/prompts`, which only the command-line tool uses.

### Using it as the core of your own app or CLI

Add it as a normal dependency and import from the package root. There is nothing else to configure.

```json
{
  "type": "module",
  "dependencies": {
    "@gurps-sheet/combat-engine": "^0.3.1"
  }
}
```

- **It is ESM only.** Use `import`, not `require`, and set `"type": "module"` (or use `.mjs` files) in your project.
- **TypeScript works out of the box.** Types ship with the package. With `"moduleResolution": "node16"`, `"nodenext"` or `"bundler"` they resolve with no extra setup.
- **If your app also imports `@gurps-sheet/character` directly** (for example to load character files), depend on a compatible range such as `^0.1.0`. npm then installs a single copy shared with the engine, so the character types you pass in match the ones it expects.
- **Pin the engine to a minor version while it is `0.x`**, since the API may change between minors until 1.0.

## Usage

### Run an automated fight between NPCs

```js
import {
  npcCombatant,
  npcGroup,
  createCombat,
  createDiceManager,
  seededSource,
  bestExpectedInjury,
  runToCompletion,
} from '@gurps-sheet/combat-engine';

const knight = npcCombatant('fantasy-mercenary-knight', { side: 'heroes' }).combatant;
const guards = npcGroup({ npc: 'fantasy-town-guard', side: 'watch', count: 3 }).map((g) => g.combatant);

const combat = createCombat([knight, ...guards], {
  dice: createDiceManager({ source: seededSource(7) }), // same seed, same fight
});

const { results, finished } = runToCompletion(combat, bestExpectedInjury);
console.log(finished, results.length, combat.view().winner);
```

`npcCombatant` and `npcGroup` build fighters from the 32 NPCs in `@gurps-sheet/npcs`. Use `listNpcs({ style, threat, tag })` to choose opponents.

### Use your own characters

Load a `gurps-character` file with the sheet library, then turn it into a combatant.

```js
import { readFileSync } from 'node:fs';
import { parseCharacter } from '@gurps-sheet/character';
import { combatantFromCharacter } from '@gurps-sheet/combat-engine';

const { character } = parseCharacter(readFileSync('hero.json', 'utf8'));
const { combatant, warnings } = combatantFromCharacter(character, { side: 'players' });

console.log(combatant.attacks.map((a) => `${a.name}: skill ${a.skill}, ${a.damage.notation} ${a.damage.type}`));
console.log(warnings); // anything on the sheet the engine could not use
```

A sheet does not record which skill a weapon uses, so the engine matches a weapon to the skill with the same name (or one part of a name like `Axe/Mace`). Pass `weaponSkills: { 'Large Knife': 'Knife' }` to map the rest. Anything it cannot use comes back in `warnings`, never silently dropped.

### Drive a fight yourself

This is the loop an interactive front end runs. `legalActions()` lists everything the current fighter may do, and `takeTurn()` plays it. When an attack hits a fighter who can defend, the turn waits: `legalDefenses()` lists that fighter's choices, each with the number it would roll against, and `defend()` finishes the turn.

```js
import { createCombat, createDiceManager, npcCombatant } from '@gurps-sheet/combat-engine';

const a = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
const b = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant;
const combat = createCombat([a, b], { dice: createDiceManager() }); // real randomness

while (combat.view().status !== 'finished') {
  const view = combat.view(); // round, whose turn, who must decide, every fighter's HP and defenses

  if (view.status === 'awaiting-defense') {
    const options = combat.legalDefenses(); // e.g. "Parry (Broadsword) + retreat", target 12
    const result = combat.defend(options[0].choice); // show these to the defender; here we take the first
    console.log(result.attack.defense, result.attack.outcome);
    continue;
  }

  const choices = combat.legalActions(); // show these to the player
  const pick = choices.find((choice) => choice.maneuver === 'attack') ?? choices[0]; // ...here we just attack
  const step = combat.takeTurn(pick);
  if (step.status === 'resolved') console.log(`round ${step.result.round}: ${step.result.actorId}`, step.result.attack?.outcome ?? '');
}
console.log('winner:', combat.view().winner);
```

Each finished turn is plain data: the attack roll, the defense chosen and rolled, the damage roll and the injury. An action or defense that isn't on offer throws a `CombatError` and changes nothing. `runToCompletion` plays this same loop with the built-in policies, `bestExpectedInjury` for actions and `bestDefense` for defenses.

### Change modifiers, look at sheets, start over

```js
import { createCombat, createDiceManager, npcCombatant } from '@gurps-sheet/combat-engine';

const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
const guard = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant;
const combat = createCombat([knight, guard], { dice: createDiceManager() });

const modifier = combat.addModifier(guard.id, { label: 'Dim light', value: -3, appliesTo: ['attack'] });
combat.updateModifier(guard.id, modifier.id, { value: -1 }); // eases off
combat.removeModifier(guard.id, modifier.id);

combat.sheetOf(guard.id); // that fighter's sheet right now, current HP included (a copy)
combat.snapshot().history; // every event so far, as plain data you can JSON.stringify
combat.reset(); // the same fight again from the start
```

A modifier with an empty `appliesTo` applies to every roll. Otherwise list the roll tags it affects: `attack`, `defense` (every defense), one of `dodge`, `parry` and `block`, or `ht` (HT rolls).

### Control the dice

Everything random goes through the dice manager, so you choose how.

```js
import { createDiceManager, randomSource, seededSource, scriptedSource, createTable } from '@gurps-sheet/combat-engine';

createDiceManager(); // real randomness
createDiceManager({ source: seededSource(42) }); // reproducible
const dice = createDiceManager({ source: scriptedSource([6, 5, 4, 3]) }); // exact faces, e.g. for tests

dice.roll('3d'); // { notation: '3d', dice: [6, 5, 4], modifier: 0, total: 15 }
dice.roll('1d+2'); // GURPS notation: 3d, 2d+1, 1d-2
dice.history(); // every roll made through this manager

const hitLocation = createTable({
  name: 'toy hit location',
  dice: '1d',
  entries: [
    { min: 1, max: 2, result: 'head' },
    { min: 3, max: 6, result: 'torso' },
  ],
});
createDiceManager({ source: seededSource(1) }).rollOnTable(hitLocation).entry.result;
```

A scripted source throws if it runs out of faces or a face is impossible for the die, so a test can never drift from what it scripted. Tables are checked to cover every possible total exactly once.

## Command-line tool

`gurps-combat` sets up and runs fights in the terminal, with arrow-key menus.

```bash
npx -p @gurps-sheet/combat-engine gurps-combat           # without installing
npm install -g @gurps-sheet/combat-engine && gurps-combat
```

With no options it opens the setup screen:

- **Add fighters** from the NPC library (by adventure style, any number of copies) or from a `gurps-character` JSON file, and put them on sides.
- **Choose which sides you control.** The AI plays the rest, or every side if you pick none.
- **Play.** On your turn you pick a maneuver, an attack and a target. When you're hit, you pick a defense from a list that shows each one's number ("Block: roll 10 or less", "Dodge + retreat: roll 12 or less"). Every roll is printed.
- **Mid-fight:** add, change or remove modifiers, view any fighter's sheet, let the AI take a turn for you, restart the fight, or go back to setup.

Options:

```text
--npc <id>[:<side>[:<count>]]   Add NPCs, e.g. --npc fantasy-town-guard:watch:3
--sheet <file>[:<side>]         Add a character from a gurps-character file
--auto                          Let the AI play every side, print the fight and exit
--seed <n>                      Replay a fight exactly (the seed is printed at the start)
```

For example, `gurps-combat --auto --seed 7 --npc fantasy-mercenary-knight:heroes --npc fantasy-town-guard:watch:2` prints a whole fight between a knight and two guards.

## What is and isn't implemented

**Implemented** (Basic Set page numbers in parentheses):
- Success rolls with critical successes and failures (pp.347-348).
- Turn order by Basic Speed, then DX, then a roll-off (p.363).
- Four maneuvers: Attack, All-Out Attack (Determined), All-Out Defense (Increased Dodge) and Do Nothing (pp.364-366).
- Melee attack and damage: DR, wounding modifiers, minimum damage, and the self-injury from punching armor (pp.369, 378-379).
- Active defenses (pp.374-377): Dodge, Parry with each weapon (unbalanced and fencing weapons, -4 or -2 per extra parry, bare-handed parries at -3 against swung weapons), Block once per turn, and Retreat once per turn. All-Out Defense raises the defense you choose (p.366). Defenders choose; the AI picks the best number.
- Brawling punches, including the damage bonus at DX+2 (pp.182, 271).
- Injury effects (pp.364, 380, 419-420): **shock** (-1 per HP lost, or per HP/10 with 20+ HP, at most -4, on the victim's next attacks only); **major wounds** (a single injury over half the HP) call for an HT roll that can **stun** or knock the victim out; a stunned fighter must Do Nothing, defends at -4 without retreating, and rolls HT each turn to recover.
- An automated driver that ranks attacks by exact expected injury against the target's best defense, and chooses All-Out Attack only when it pays.

**Simplified for now:**
- **No shield DB or Combat Reflexes bonus on defenses.** A retreat is always possible, since there is no battle map.
- **Every hit lands on the torso.** There are no hit locations.
- **A fighter is out at 0 HP or less** (or unconscious). The HT rolls at 0 HP and below, mortal wounds and death are not implemented. A knockdown stuns, but falling prone isn't modelled (no postures).
- **A critical hit only removes the defense.** The Critical Hit and Critical Miss tables (p.556) are not applied.
- **Melee only, on foot.** Ranged weapons, lances (mounted combat) and the other nine maneuvers are not modelled. NPCs whose only weapons are ranged (casters, doctors, shooters) have no attack yet; the engine reports why.
- **Dodge ignores encumbrance and low HP.**
- **No fighter can join a fight in progress.** The turn order is fixed at the start (p.363).

These are limits of this version, not rules choices. Where the sheet or the rules don't cover something, the engine says so in a warning or an error instead of guessing.

## API at a glance

| Area | Main exports |
|---|---|
| Fights | `createCombat`, `combat.view()`, `legalActions()`, `takeTurn()`, `legalDefenses()`, `defend()`, `sheetOf()`, `reset()`, `snapshot()`, `CombatError` |
| Fighters | `combatantFromCharacter`, `npcCombatant`, `npcGroup`, `listNpcs`, `turnOrder` |
| Automation | `runToCompletion`, `bestExpectedInjury`, `bestDefense`, `expectedInjury`, `successChance`, the `Policy` and `DefensePolicy` types |
| Dice | `createDiceManager`, `randomSource`, `seededSource`, `scriptedSource`, `createTable`, `parseNotation` |
| Modifiers | `ModifierSet`, plus `addModifier`, `updateModifier` and `removeModifier` on a combat |
| Rules | `rollSuccess`, `classifyRoll`, `resolveInjury`, `rollDamage`, `shockPenalty`, `isMajorWound`, `knockdownOutcome`, `MANEUVER_EFFECTS` |
| State machine | `createMachine`, `InvalidTransitionError` (the generic machine the combat is built on) |

Everything is exported from the package root and fully typed.

## Development

```bash
npm install
npm test         # typecheck, then the unit tests
npm run build    # compile to dist/
npm run cli      # run gurps-combat from source; pass flags after --, e.g. npm run cli -- --help
```

A release is a version bump in a pull request: `npm version patch --no-git-tag-version`. Merging to `main` publishes it. npm may hold a new publish for approval with two-factor authentication before it goes live.

## License

UNLICENSED: no license is granted yet, as with the other `@gurps-sheet` packages.
