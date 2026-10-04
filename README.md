# @gurps-sheet/engine

A combat engine for **GURPS 4th Edition**, written as a library. It takes characters in the [`gurps-character`](https://www.npmjs.com/package/@gurps-sheet/character) format, runs a fight by the Basic Set rules, and tells you exactly what happened: every roll, every modifier, every point of injury.

It is the core that other tools build on, such as a command-line combat manager, a VTT bridge, or a test harness. It has no user interface of its own, no input/output and no global state, so the same fight runs identically in a terminal, a server or a unit test.

- **Written in TypeScript, shipped as ES modules** (`dist/`, with declarations and source maps). Requires Node ≥ 20.19.
- **Built on the sheet libraries.** Characters come from [`@gurps-sheet/character`](https://www.npmjs.com/package/@gurps-sheet/character), and ready-made NPCs from [`@gurps-sheet/npcs`](https://www.npmjs.com/package/@gurps-sheet/npcs). Both install with it.
- **Early version (0.1).** Melee combat works end to end. See [What is and isn't implemented](#what-is-and-isnt-implemented) before relying on it.

## Goals

1. **Follow the rules.** Every rule cites its Basic Set page in the source, and the tests are tables of cases taken from those pages.
2. **One state machine for the whole fight.** The full state (turn order, round, maneuvers, HP, modifiers) lives in one place and can be reset or restarted at any time. Every change is a plain-data event, so the history can be logged as JSON.
3. **Reproducible by construction.** Every random outcome goes through one dice manager. Give it real randomness, a seed, or a script of exact die faces, and the same fight plays out the same way.
4. **Modifiers you can change mid-fight.** Add, edit or remove a situational modifier at any time. Later rolls change; rolls already made don't.
5. **Interactive or automated, on the same engine.** A person, a script or the built-in policy picks from `legalActions()`, and `takeTurn()` accepts exactly those actions.
6. **The engine owns combat conditions.** The sheet only stores current HP and FP. Shock, stun and the like belong to the fight, not to the character document. (They are not implemented yet.)

## Install

```bash
npm install @gurps-sheet/engine
```

That also installs `@gurps-sheet/character` and `@gurps-sheet/npcs`, which the engine depends on.

### Using it as the core of your own app or CLI

Add it as a normal dependency and import from the package root. There is nothing else to configure.

```json
{
  "type": "module",
  "dependencies": {
    "@gurps-sheet/engine": "^0.1.1"
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
} from '@gurps-sheet/engine';

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
import { combatantFromCharacter } from '@gurps-sheet/engine';

const { character } = parseCharacter(readFileSync('hero.json', 'utf8'));
const { combatant, warnings } = combatantFromCharacter(character, { side: 'players' });

console.log(combatant.attacks.map((a) => `${a.name}: skill ${a.skill}, ${a.damage.notation} ${a.damage.type}`));
console.log(warnings); // anything on the sheet the engine could not use
```

A sheet does not record which skill a weapon uses, so the engine matches a weapon to the skill with the same name (or one part of a name like `Axe/Mace`). Pass `weaponSkills: { 'Large Knife': 'Knife' }` to map the rest. Anything it cannot use comes back in `warnings`, never silently dropped.

### Drive a fight yourself

This is the loop a command-line or interactive front end runs. `legalActions()` lists everything the current fighter may do, and `takeTurn()` plays the turn.

```js
import { createCombat, createDiceManager, npcCombatant } from '@gurps-sheet/engine';

const a = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
const b = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant;
const combat = createCombat([a, b], { dice: createDiceManager() }); // real randomness

while (combat.view().status === 'in-progress') {
  const view = combat.view(); // round, whose turn, every fighter's HP and maneuver
  const choices = combat.legalActions(); // show these to the player
  const pick = choices.find((choice) => choice.maneuver === 'attack') ?? choices[0]; // ...here we just attack
  const result = combat.takeTurn(pick);
  console.log(`round ${result.round}: ${result.actorId} ${result.maneuver}`, result.attack?.outcome ?? '');
}
console.log('winner:', combat.view().winner);
```

`takeTurn()` returns the whole turn: the attack roll, the defense roll, the damage roll and the injury, each as plain data. An action that is not in `legalActions()` throws a `CombatError` and changes nothing.

### Change modifiers, look at sheets, start over

```js
import { createCombat, createDiceManager, npcCombatant } from '@gurps-sheet/engine';

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

A modifier with an empty `appliesTo` applies to every roll. Otherwise list the roll tags it affects: `attack`, `defense` or `dodge`.

### Control the dice

Everything random goes through the dice manager, so you choose how.

```js
import { createDiceManager, randomSource, seededSource, scriptedSource, createTable } from '@gurps-sheet/engine';

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

## What is and isn't implemented

**Implemented** (Basic Set page numbers in parentheses):
- Success rolls with critical successes and failures (pp.347-348).
- Turn order by Basic Speed, then DX, then a roll-off (p.363).
- Four maneuvers: Attack, All-Out Attack (Determined), All-Out Defense (Increased Dodge) and Do Nothing (pp.364-366).
- Melee attack, Dodge and damage: DR, wounding modifiers, minimum damage, and the self-injury from punching armor (pp.369, 374-375, 378-379).
- Brawling punches, including the damage bonus at DX+2 (pp.182, 269).
- An automated driver that ranks attacks by exact expected injury and chooses All-Out Attack only when it pays.

**Simplified for now:**
- **Dodge is the only active defense.** No Parry, Block or Retreat yet.
- **Every hit lands on the torso.** There are no hit locations.
- **A fighter is out at 0 HP or less.** Shock, stun, knockdown, the HT rolls at 0 HP, mortal wounds and death are not implemented.
- **A critical hit only removes the defense.** The Critical Hit and Critical Miss tables (p.556) are not applied.
- **Melee only.** Ranged weapons, and the other nine maneuvers, are not modelled. NPCs whose only weapons are ranged (casters, doctors, shooters) have no attack yet; the engine reports why.
- **Dodge ignores encumbrance and low HP.**
- **No fighter can join a fight in progress.** The turn order is fixed at the start (p.363).

These are limits of this version, not rules choices. Where the sheet or the rules don't cover something, the engine says so in a warning or an error instead of guessing.

## API at a glance

| Area | Main exports |
|---|---|
| Fights | `createCombat`, `combat.view()`, `legalActions()`, `takeTurn()`, `sheetOf()`, `reset()`, `snapshot()`, `CombatError` |
| Fighters | `combatantFromCharacter`, `npcCombatant`, `npcGroup`, `listNpcs`, `turnOrder` |
| Automation | `runToCompletion`, `bestExpectedInjury`, `expectedInjury`, `successChance`, the `Policy` type |
| Dice | `createDiceManager`, `randomSource`, `seededSource`, `scriptedSource`, `createTable`, `parseNotation` |
| Modifiers | `ModifierSet`, plus `addModifier`, `updateModifier` and `removeModifier` on a combat |
| Rules | `rollSuccess`, `classifyRoll`, `resolveInjury`, `rollDamage`, `MANEUVER_EFFECTS` |
| State machine | `createMachine`, `InvalidTransitionError` (the generic machine the combat is built on) |

Everything is exported from the package root and fully typed.

## Development

```bash
npm install
npm test         # typecheck, then the unit tests
npm run build    # compile to dist/
```

A release is a version bump in a pull request: `npm version patch --no-git-tag-version`. Merging to `main` publishes it. npm may hold a new publish for approval with two-factor authentication before it goes live.

## License

UNLICENSED: no license is granted yet, as with the other `@gurps-sheet` packages.
