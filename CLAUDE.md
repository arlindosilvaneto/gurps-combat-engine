# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # installs @gurps-sheet/character and /npcs from npm, then `prepare` builds dist/
npm test             # typecheck, then unit tests
npm run typecheck    # tsc -p tsconfig.json (src + test, strict)
npm run test:unit    # node --import tsx --test test/*.test.ts
npm run build        # tsc -p tsconfig.build.json -> dist/ (what consumers import)
node --import tsx --test test/dice.test.ts                       # one file
node --import tsx --test --test-name-pattern="reset" test/*.test.ts   # one test by name
node --import tsx src/cli/main.ts --help                         # the gurps-combat CLI, from source
node --import tsx src/cli/main.ts --auto --seed 7 --npc fantasy-mercenary-knight:heroes --npc fantasy-town-guard:watch:2
```

TypeScript (ESM, Node `>=20.19`), set up like `../gurps-sheet/packages/character`: `tsx` runs tests straight from `.ts`, `tsc` typechecks and builds. Relative imports use `.js` specifiers (nodenext), and `verbatimModuleSyntax` requires `import type` for type-only imports. `noUncheckedIndexedAccess` is on. There is no linter yet.

**The `@gurps-sheet/*` packages come from the npm registry** (`^0.1.0`), like any other dependency, so a fresh clone needs only `npm install`. They are published by the release workflow in `../gurps-sheet` when a version bump merges to `main`. A new version can take a minute or two to show up on the registry after the workflow finishes (a 404 right after a release is propagation lag, not a missing publish). To develop against unreleased changes in `../gurps-sheet`, link it temporarily (`npm link ../gurps-sheet/packages/character`, after running `npm run build` there, since the package exports its gitignored `dist/`) and undo it with `npm install @gurps-sheet/character@^0.1.0` before committing. Never commit a `file:` or `link:` dependency or a lockfile `link: true` entry.

## CI/CD

Set up like `../gurps-sheet` (`.github/workflows/`, `scripts/release.mjs`), adapted to a single package instead of a workspace.

- **`ci.yml`** runs on pull requests and pushes to `main`. `test` runs `npm ci` (which builds `dist/` through `prepare`), `npm test` and `npm pack --dry-run` on Node 20.19 (the minimum in `engines`; there is no version matrix). `release-check` (pull requests only) runs `node scripts/release.mjs check`.
- **`release.yml`** runs on pushes to `main` that touch `src/`, `package.json`, the lockfile or `tsconfig.build.json`, and by hand (`workflow_dispatch`, with a dry-run option). It runs the tests, then `node scripts/release.mjs publish`: publish if `package.json`'s version isn't on the registry yet (with provenance), then tag `vX.Y.Z` and create a GitHub release.
- **A release is a version bump in the pull request** (`npm version patch --no-git-tag-version`). `check` fails a PR that changes `src/` or `package.json` without one, once the package is published. Test-only, docs and CI changes need no bump.
- **`check` also rejects local-path dependencies**: a `file:` or `link:` dependency, or a `link: true` entry in `package-lock.json` (what `npm link` leaves behind). It runs on every pull request.
- `npm test` is the one check CI runs; run it locally before pushing. `NPM_REGISTRY_TOKEN` is the repository secret that publishing uses.

**Publishing is on.** The package is public (no `"private"` in `package.json`, and `publishConfig.access` is `public`) and publishes as **`@gurps-sheet/engine`** on the public npm registry, in the same org as `@gurps-sheet/character` and `/npcs`, with the same `NPM_REGISTRY_TOKEN`. Merging to `main` publishes whatever `package.json` version isn't on the registry yet, and every later release needs a version bump in its pull request. Publishing can't be cleanly undone (npm only allows unpublishing in narrow cases, and a version number can never be reused), so treat each version bump as a release. To pause releases, put `"private": true` back: the release script skips private packages. The license is `UNLICENSED`, like the sibling packages. `README.md` is the package page on npm, but npm only shows the README that was in the published tarball, so a README change reaches the page with the next version bump (it needs no bump of its own).

**npm may stage a publish instead of releasing it.** Staged publishing is an npm feature where `npm publish` succeeds (the job log ends with `+ <name>@<version>`) but the version is held until a maintainer approves it with 2FA: on npmjs.com under the package's **Staged Packages** tab, or with `npm stage approve <stage-id>` (needs npm 11.15+ and Node 22.14+). Until then the registry only has a public `0.0.0-stage` placeholder, so installing the package fails, and re-running the release would be refused because the staged version already holds that number. If a release job succeeds but `npm view @gurps-sheet/engine@<version>` is a 404, check for a staged version before assuming anything went wrong.

**History:** the first attempt published as the unscoped `gurps-combat-engine`, which npm staged under the personal account and which was never approved or released, so that name holds only a `0.0.0-stage` placeholder. The package moved to `@gurps-sheet/engine` at `0.1.1`, because the GitHub release and tag `v0.1.0` already existed and the release script would fail creating a second `v0.1.0`.

## Current state

A playable version: a melee fight between two or more sides, with Dodge, Parry and Block, played by hand or automatically, plus the `gurps-combat` CLI. Only the pieces below exist.

- `src/dice/`: the dice manager (`createDiceManager`), die sources (random, seeded, scripted), notation parsing, and validated result tables. Rolls are frozen.
- `src/modifiers/`: the immutable `ModifierSet`. Modifiers are selected by roll tags (`ROLL_TAGS` in `combat/types.ts`: `attack`, `defense` for any defense, and `dodge`, `parry`, `block`).
- `src/machine/`: a generic, rules-agnostic state machine (`createMachine<State, Context, Event>`: guards, `assign` reducers, history, `reset()`). The event union drives the types, and a transition's `target` may be a function of the context *after* `assign`.
- `src/rules/`: pure rules, each citing its Basic Set page. `success-roll.ts` (`classifyRoll`, `rollSuccess`) and `damage.ts` (wounding modifiers, DR, `resolveInjury`, `rollDamage`).
- `src/combat/`: the fight itself.
  - `combatant.ts`: `combatantFromCharacter` turns a sheet into a `Combatant` (speed, DX, Dodge, torso DR, attacks, parries, Block). Weapons are matched to skills by name, because the sheet doesn't link them. It builds a punch from Brawling, one parry per usable weapon (3 + skill/2 + the weapon's parry modifier; none for "No"; "U" and "F" flags kept), a bare-handed parry for fighters without melee weapons, and takes Block from the sheet. Lance attacks are left out (mounted only, p.204). Anything it can't use comes back as a warning.
  - `npcs.ts`: `npcCombatant(npcId, { side })` and `npcGroup({ npc, side, count })` build combatants from the NPC library, mapping weapons to skills through its catalog. A group of several is numbered so the copies have distinct ids and names. `listNpcs` is re-exported for choosing opponents.
  - `turn-order.ts`: Basic Speed, then DX, then a roll-off, fixed for the whole fight.
  - `maneuvers.ts`, `attack.ts` and `defense.ts`: the four maneuvers (All-Out Defense raises a chosen defense), the attack roll and damage, and the defenses. `defense.ts` lists every legal defense (Dodge, each parry, Block, each with or without a retreat) and computes its target number with one function that both the menus and the roll use, so the number a player is shown is the number rolled against. Per-turn limits (one Block, one retreat, -4 or -2 per extra parry, an unbalanced weapon that just attacked) live in `FighterState.defenseUse` and `attackedWith`, and reset when that fighter takes its own turn.
  - `combat.ts`: `createCombat` wires it all into one state machine with three states: `in-progress`, `awaiting-defense` and `finished`. `takeTurn(action)` returns a `TurnStep`: either the finished turn, or, when an attack hits someone with a defense to choose, the pending attack (an `AWAIT_DEFENSE` event). Then `legalDefenses()` lists the choices and `defend(choice)` finishes the turn. A miss, a critical hit, or a defender with no legal defense (All-Out Attack) finishes at once. The finished turn is sent as a `RESOLVE_TURN` event; the reducer that applies it is pure, and every dice roll happens before it. `legalActions()`, `view()` (with `awaitingId`: who must decide next), `sheetOf(id)` (a fighter's current sheet, HP included, as a copy), `addModifier`/`updateModifier`/`removeModifier` (allowed while a defense is pending) and `reset()` are the surface a driver uses. Fighters can't join a fight in progress: the turn order is fixed at the start (p.363).
    - **`legalActions()` and `legalDefenses()` are the only places legality is decided.** `takeTurn` and `defend` accept exactly those, and `explainIllegal` only words the error. When you add a maneuver or a defense, change those and nothing else.
    - **Every event is plain data** (`AWAIT_DEFENSE`, `RESOLVE_TURN`, `ADD_MODIFIER`, `UPDATE_MODIFIER`, `REMOVE_MODIFIER`), so `snapshot().history` survives `JSON.stringify` and replaying it rebuilds the same state, modifier ids included. Never put a class instance in an event.
    - The fight is over when at most one side has anyone standing, which includes everyone falling together (`winner` is then null). Decide it from who is standing, never from `winner`.
  - `expectation.ts`: `expectedInjury` computes the average HP an attack takes, exactly, from the 3d6 and damage-dice distributions.
  - `automation.ts`: `runToCompletion(combat, policy, { defense })`, the `bestExpectedInjury` action policy and the `bestDefense` defense policy. `bestExpectedInjury` picks the (attack, target) pair with the highest expected injury against the target's best defense, capped at the target's remaining HP, and chooses All-Out Attack only when its extra expected damage exceeds the extra damage the enemies are expected to deal back to a fighter who can't defend. It ignores recoil and per-turn defense limits, doesn't value a kill beyond the HP removed, and assumes each enemy attacks once before its next turn. `bestDefense` takes the highest target number, keeping a retreat for later on a tie.
- `src/cli/`: the `gurps-combat` command (`bin` in `package.json`, built to `dist/cli/main.js`).
  - **The library never imports `src/cli/`** (`src/index.ts` doesn't export it). The owner chose to ship the CLI inside this package rather than as a separate repo, so `@inquirer/prompts` is a runtime dependency every consumer installs.
  - `main.ts` parses flags with `node:util` `parseArgs` (`--npc id[:side[:count]]`, `--sheet file[:side]`, `--auto`, `--seed`), and picks a random seed with `node:crypto` when none is given, printing it so a fight can be replayed. `app.ts` is the setup screen and the fight loop: sides the user doesn't control are played by `bestExpectedInjury` and `bestDefense`, and an all-AI fight stops as a stalemate after `maxTurns`. `roster.ts` loads sheets and NPCs and makes ids and names unique. `format.ts` turns turns, rolls and the status table into text.
  - **Everything interactive goes through the `Prompter` interface in `io.ts`.** `inquirer.ts` adapts it to `@inquirer/prompts`; `test/cli.test.ts` drives whole sessions with a scripted prompter that checks each prompt's message and that every answer is an enabled choice, so menu drift fails a test. Don't call inquirer directly from `app.ts`.
  - The real terminal adapter can be smoke-tested with a pseudo-terminal: `(sleep 2; printf '\033[B\r') | script -q /dev/null node dist/cli/main.js`.

**Deliberate simplifications of this version.** Don't treat these as bugs, and remove each one as the real rule is added:
- Maneuvers: Attack, All-Out Attack (Determined), All-Out Defense (Increased Defense, on a chosen defense) and Do Nothing. The other nine, and All-Out Defense's Double Defense option, aren't modelled.
- Defenses: shield DB and Combat Reflexes are not added (the sheets record a shield's DB only as text in an equipment name, e.g. "Medium Shield (DB 2)"). A bare-handed parry is offered only to fighters without melee weapons, since free hands aren't tracked. Not modelled: off-hand and thrown-weapon parry penalties, weapons breaking on heavy parries, injuring an unarmed attacker with a weapon parry, Brawling's two parries per turn, and a retreat's bonus carrying over to the same attacker's later attacks.
- A retreat is always possible: there is no battle map, so the engine never knows when there is no room to step back. `bestDefense` therefore retreats whenever that gives the best number, which makes nimble fighters (Dodge + 3) hard to hit.
- Lance attacks are left out: the Lance skill is for fighting from horseback (p.204), and mounted combat isn't modelled.
- A critical hit only removes the defense. The Critical Hit and Critical Miss tables (p.556) aren't applied.
- Hurting Yourself (p.379: an unarmed hit on DR 3+ costs the attacker) is applied, but the attacker's own DR on the striking limb is ignored, since there are no hit locations. It can defeat the attacker.
- Every hit lands on the torso. There are no hit locations.
- Dodge is the unencumbered value, and reeling (under 1/3 HP halves Dodge) isn't applied.
- A fighter is out at 0 HP or less. Shock, major wounds, stun, the HT rolls at 0 HP and at -1×HP, and death are not implemented. Conditions are still to come (see below).
- Weapon damage types fatigue, toxic and the special types are skipped, along with ranged weapons and flat (zero-dice) damage. Each skipped weapon comes back as a warning from `combatantFromCharacter`.
- The DR note on a sheet ("2 contra contusão") is ignored: the number is used for every damage type.

`machine.snapshot()` copies the whole history on each call, and the automated loop calls it several times per turn, so a very long fight costs quadratic time (20,000 turns took about 0.7 s). That's fine at this scale; give the machine a copy-free read of state and context if it ever matters.

Still to build, roughly in this order: shock with modifier expiry (the temporary penalty lasts one turn, so `ModifierSet` needs a duration), then reeling and the HT rolls (unconsciousness, death, major wound, stun) as engine-owned conditions, then Feint, Evaluate, Wait, ranged attacks and hit locations. Verify each rule against the Basic Set PDF before encoding it.

## What this is

A library of tools for an RPG combat engine following **GURPS 4th Edition** rules, plus the `gurps-combat` CLI that uses it for interactive setup and play. The CLI lives in `src/cli/` of this same package (the owner's decision); keep every other module free of terminal and IO code, so the engine stays usable and testable headless.

Requirements from the project brief:
- **Rules-faithful combat workflow.** One state machine holds the entire combat for the current execution, and it must be resettable/restartable on demand.
- **Dice manager.** All rolls go through it. It must support a real RNG and a deterministic mode, and it must be able to resolve a roll from a table of results.
- **Modifiers.** They apply to rolls and can be added, removed or changed mid-combat.
- **Two drivers.** A fully interactive combat and a fully automated one. The automated driver picks the best action for the character from the rules.
- **Character data** comes from the `@gurps-sheet` library (see below), for the character sheet selected for the encounter.

## Architecture constraints these requirements imply

- **Single source of combat truth.** Combat state (turn order, current actor, maneuver, active conditions, modifiers, pools) lives in the state machine. Reset restores it from the loaded character documents, not from leftover in-memory state. Because conditions are not persisted in the character document, a reset clears them by design.
- **Every random outcome goes through the dice manager.** Never call `Math.random` elsewhere. Deterministic mode is what makes the state machine and the automated driver testable, so inject the dice manager rather than importing a global.
- **Modifiers are data attached to state, not baked into roll results.** A roll resolves against a target number plus the currently active modifier set. Removing or editing a modifier must change later rolls without rewriting history.
- **Interactive and automated drivers share one engine interface.** The automated driver is a decision policy that chooses legal actions where the interactive driver would prompt a human. It must only be able to choose actions the state machine currently allows.

## The `@gurps-sheet/character` dependency

Source: `../gurps-sheet/packages/character`, published as `@gurps-sheet/character` on npm (`0.1.0`; its `README.md`, shipped in the package, is the API guide). Its `exports` doesn't expose `examples/`, but they are in the package, so tests locate them via `import.meta.resolve('@gurps-sheet/character/package.json')` (see `test/fixtures.ts`).

`@gurps-sheet/npcs` (same repo, `packages/npcs`) provides 32 ready-made Basic Set NPCs in the same format, in six adventure styles (`getNpc(id)`, `listNpcs({ style, threat, tag })`). Each `getNpc` call returns a fresh copy, so combatants made from the same NPC are independent. Its `/catalog` subpath has the Basic Set weapon table, which records the skill each weapon uses (the sheet itself doesn't). Many NPCs have no usable attack yet: casters, doctors and shooters whose only weapons are ranged get a warning, not an error.

What it provides, and what it deliberately does not:
- **Loading:** `parseCharacter(json)` returns `{ character, report }`. Errors are `CharacterError` with a stable `code`. Engine-facing messages are English.
- **Combat view:** `combatStats(doc)` returns a read-only copy: HP/FP pools, Dodge/Parry/Block, thrust/swing damage, Basic Speed/Move, encumbrance levels, DR, skills with levels, and weapons. Mutating it never reaches the document.
- **In-play state is only current HP and FP.** `applyDamage`, `heal`, `spendFatigue` and `recoverFatigue` clamp to the schema bounds. `updateCharacter` is strict and throws. All of them return a new document and never mutate their input.
- **The schema decides what is updatable** (`x-gurps.role: "state"`). Never work around it from this repo. If the engine needs a new persisted field, that is a schema change in `gurps-sheet`.
- **Rule consequences are this engine's job.** The library only bounds the pools. Death checks below 0 HP, HP loss when FP goes negative, shock, knockdown and the like are not implemented there.
- **Conditions are owned by this engine (decided).** `@gurps-sheet/character` has no condition model, so conditions live in this engine's state machine and are not written back to the character document. Only HP/FP changes go through the library's helpers. Do not extend the `gurps-sheet` schema for conditions.
- **Rule integrity:** `verifyCharacter(doc)` never trusts the file's own `integrity` block. A character may carry `deviations` (manual overrides with no point cost) and an `experimental` flag. The engine should decide deliberately whether to accept those characters.
- `@gurps-sheet/character/formula` and `/constants` can be imported without Ajv, so use them when you need only rule math.

`gurps-sheet` follows the GURPS Basic Set where the original PDF sheet diverged. For example, Dodge is `floor(Basic Speed) + 3`, not based on Basic Move. Follow the Basic Set for rules in this repo too, and cite the page when a rule is non-obvious.

## Rules reference

`../gurps_kb/gurps.pdf` is the GURPS 4e Basic Set (about 16 MB, 580 pages). Read targeted page ranges, never the whole file.

- **The PDF page number is not the printed page number, and the gap changes through the book:** +2 up to at least printed p.326 (e.g. skills p.204 is PDF page 206, the weapon tables p.271 is 273), +4 from p.347 on (success rolls p.347 is PDF page 351, combat p.363 is 367). Always read the printed number at the bottom of the extracted page (`SKILLS 203`, `COMBAT 369`) instead of assuming an offset, and cite *printed* pages in code and tests.
- **The Read tool can't open this PDF here** (it needs `pdftoppm`, which isn't installed), and no other PDF tool is installed. The text layer is clean, so extract it with `pypdf` in a throwaway venv, one file per page, and `grep` those files:
  `python3 -m venv $VENV && $VENV/bin/pip install pypdf fonttools`, then write `PdfReader(...).pages[i].extract_text()` to `pNNN.txt`, with `logging.disable(logging.CRITICAL)` set (pypdf prints huge font warnings otherwise).
- Rules verified and encoded so far: success rolls and criticals (pp.347-348); 17-18 always fail (pp.369, 374); turn order and the four maneuvers (pp.363-366); attack, defense and Dodge (pp.369, 374-375); Parry, Block and Retreat, with their per-turn limits (pp.375-377); All-Out Defense's Increased Defense (p.366); Lance is for mounted combat (p.204); DR, wounding modifiers, the damage minimums and Hurting Yourself (pp.378-379); punch damage (p.271) and Brawling's damage bonus (p.182). Read but not yet encoded: shock, major wounds, stun (pp.380, 419-420), the HT rolls at 0 HP and -1×HP (p.419), mortal wounds and death (p.423).
