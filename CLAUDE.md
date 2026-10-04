# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # symlinks ../gurps-sheet/packages/character, then `prepare` builds dist/
npm test             # typecheck, then unit tests
npm run typecheck    # tsc -p tsconfig.json (src + test, strict)
npm run test:unit    # node --import tsx --test test/*.test.ts
npm run build        # tsc -p tsconfig.build.json -> dist/ (what consumers import)
node --import tsx --test test/dice.test.ts                       # one file
node --import tsx --test --test-name-pattern="reset" test/*.test.ts   # one test by name
```

TypeScript (ESM, Node `>=20.19`), set up like `../gurps-sheet/packages/character`: `tsx` runs tests straight from `.ts`, `tsc` typechecks and builds. Relative imports use `.js` specifiers (nodenext), and `verbatimModuleSyntax` requires `import type` for type-only imports. `noUncheckedIndexedAccess` is on. There is no linter yet.

**The sheet library must be built first.** `@gurps-sheet/character` exports its types and code from its gitignored `dist/`. If imports or types from it are missing or stale, run `npm run build` in `../gurps-sheet/packages/character`. A `file:` link does not trigger its `prepare` step.

## Current state

Scaffolded infrastructure only, with no GURPS rules yet:
- `src/dice/`: the dice manager (`createDiceManager`), die sources (random, seeded, scripted), notation parsing, and validated result tables. Rolls are frozen.
- `src/modifiers/`: the immutable `ModifierSet`.
- `src/machine/`: a generic, rules-agnostic state machine (`createMachine<State, Context, Event>`: guards, `assign` reducers, history, `reset()`). The event union drives the types, so each guard and reducer receives its own event's narrowed type, and a misspelled target state fails to compile.
- `src/rules/success-roll.ts`: `classifyRoll` (pure 3d classification) and `rollSuccess` (rolls through the dice manager, applying the active `ModifierSet` to the skill by roll tags). The first rules module; each rule in it cites its Basic Set page, and `test/success-roll.test.ts` is a table of cases from those pages.
- `test/sheet-integration.test.ts`: proves the `@gurps-sheet/character` link and the HP helpers work.

Still to build: the GURPS combat state machine itself (turn order, maneuvers, attack/defense, damage), conditions, a combatant adapter over `combatStats`, and the interactive and automated drivers. Verify each rule against the Basic Set PDF before encoding it.

## What this is

A base library (not an app) of tools for an RPG combat engine following **GURPS 4th Edition** rules. A separate local CLI will consume it for interactive setup and for managing conditions during an encounter. Keep the library free of any terminal/IO dependency, so the CLI stays a thin consumer and the engine is testable headless.

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

Source: `../gurps-sheet/packages/character` (its `README.md` is the API guide; `types/index.d.ts` is the typed surface). It is a private, unpublished npm workspace package (`0.1.0`, UNLICENSED), linked here as `"file:../gurps-sheet/packages/character"`, so `node_modules/@gurps-sheet/character` is a symlink and edits there show up immediately. This only works while the two repos stay side by side. Its `exports` doesn't expose `examples/`; tests locate them via `import.meta.resolve('@gurps-sheet/character/package.json')` (see `test/sheet-integration.test.js`).

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

- **PDF page = printed page + 4** (e.g. success rolls, printed p.347, is PDF page 351). Cite *printed* pages in code and tests.
- **The Read tool can't open this PDF here** (it needs `pdftoppm`, which isn't installed), and no other PDF tool is installed. The text layer is clean, so extract it with `pypdf` in a throwaway venv, one file per page, and `grep` those files:
  `python3 -m venv $VENV && $VENV/bin/pip install pypdf fonttools`, then write `PdfReader(...).pages[i].extract_text()` to `pNNN.txt`, with `logging.disable(logging.CRITICAL)` set (pypdf prints huge font warnings otherwise).
- Rules that are verified and encoded so far: success rolls, critical success and failure (p.347-348); 17-18 always fail (p.369, p.374).
