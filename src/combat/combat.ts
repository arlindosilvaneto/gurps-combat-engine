import { applyDamage, getPool, type GurpsCharacter, type Pool } from '@gurps-sheet/character';
import type { DiceManager } from '../dice/dice-manager.js';
import { ModifierSet, type Modifier, type ModifierPatch, type NewModifier } from '../modifiers/modifier-set.js';
import { createMachine, type Machine, type Snapshot } from '../machine/machine.js';
import { resolveAttack } from './attack.js';
import type { AttackOption, Combatant } from './combatant.js';
import { MANEUVER_EFFECTS, type Maneuver } from './maneuvers.js';
import { turnOrder } from './turn-order.js';
import {
  isAttackAction,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type FighterState,
  type TurnAction,
  type TurnResult,
} from './types.js';

/** A request the current rules don't allow: the combat is unchanged. */
export class CombatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CombatError';
  }
}

export interface CombatOptions {
  /** Every roll in the fight goes through this. */
  readonly dice: DiceManager;
  /** Time source for the sheet's `updatedAt` stamp; inject it for reproducible runs. */
  readonly clock?: () => Date;
}

export interface FighterView {
  readonly id: string;
  readonly name: string;
  readonly side: string;
  readonly hp: Pool;
  readonly dodge: number;
  readonly dr: number;
  readonly maneuver: Maneuver;
  /** Out of the fight (0 HP or less; the HT rolls to stay up aren't modelled yet). */
  readonly defeated: boolean;
  readonly attacks: readonly AttackOption[];
  readonly modifiers: readonly Modifier[];
}

export interface CombatView {
  readonly status: CombatState;
  readonly round: number;
  /** Whose turn it is, or null once the fight is over. */
  readonly currentId: string | null;
  /** The side left standing, once the fight is over. None if the last fighters fell together. */
  readonly winner: string | null;
  /** Fighters in turn order. */
  readonly fighters: readonly FighterView[];
}

export interface Combat {
  view(): CombatView;
  /** The raw machine state and history, for logging or replay. Every event in the history is plain data. */
  snapshot(): Snapshot<CombatState, CombatContext, CombatEvent>;
  /** Every action the current fighter may take right now. `takeTurn` accepts exactly these. */
  legalActions(): readonly TurnAction[];
  /** Resolves the current fighter's whole turn and passes play to the next one. Throws `CombatError` if the action isn't legal. */
  takeTurn(action: TurnAction): TurnResult;
  /** Throw `CombatError` once the fight is over or for an unknown fighter. */
  /**
   * A fighter's sheet as it stands now, current HP included: for showing an NPC (or anyone) mid-fight.
   * It's a copy, so changing it changes nothing in the fight. Throws `CombatError` for an unknown fighter.
   */
  sheetOf(fighterId: string): GurpsCharacter;
  addModifier(fighterId: string, modifier: NewModifier): Modifier;
  updateModifier(fighterId: string, modifierId: string, patch: ModifierPatch): void;
  removeModifier(fighterId: string, modifierId: string): void;
  /**
   * Starts the same fight over: each fighter's HP is restored from the sheet it started with
   * (not necessarily full HP), maneuvers and modifiers are cleared, and the tie-break is re-rolled.
   */
  reset(): void;
}

const hpOf = (fighter: FighterState): Pool => getPool(fighter.character, 'hp');
const isDefeated = (fighter: FighterState): boolean => hpOf(fighter).current <= 0;

const sameAction = (a: TurnAction, b: TurnAction): boolean =>
  a.maneuver === b.maneuver &&
  (!isAttackAction(a) || (isAttackAction(b) && a.attackId === b.attackId && a.targetId === b.targetId));

export function createCombat(combatants: readonly Combatant[], { dice, clock = () => new Date() }: CombatOptions): Combat {
  // Our own copy: a caller changing its array later must not change this fight.
  const roster = [...combatants];
  const byId = new Map(roster.map((combatant) => [combatant.id, combatant]));
  if (byId.size !== roster.length) throw new RangeError('Combatant ids must be unique');
  // Checked before the machine exists, since building it rolls the tie-break dice.
  const startingSides = new Set(roster.filter((c) => getPool(c.character, 'hp').current > 0).map((c) => c.side));
  if (startingSides.size < 2) throw new RangeError('A combat needs at least two sides with a fighter above 0 HP');

  const sidesStanding = (fighters: CombatContext['fighters']): string[] => [
    ...new Set(roster.filter((c) => !isDefeated(fighters[c.id]!)).map((c) => c.side)),
  ];

  function startingContext(): CombatContext {
    const order = turnOrder(roster, dice);
    const fighters = Object.fromEntries(
      roster.map((c): [string, FighterState] => [c.id, { character: c.character, maneuver: 'do-nothing', modifiers: new ModifierSet() }]),
    );
    return { round: 1, order, turnIndex: order.findIndex((id) => !isDefeated(fighters[id]!)), fighters, winner: null };
  }

  const fighterIn = (context: CombatContext, id: string): FighterState => {
    if (!Object.hasOwn(context.fighters, id)) throw new CombatError(`Unknown combatant "${id}"`);
    return context.fighters[id]!;
  };

  /** Applies a resolved turn: the actor's maneuver, any injury to the target and the actor, and who acts next. */
  function applyTurn(context: CombatContext, { result, at }: Extract<CombatEvent, { type: 'RESOLVE_TURN' }>): CombatContext {
    const fighters: Record<string, FighterState> = { ...context.fighters };
    fighters[result.actorId] = { ...fighters[result.actorId]!, maneuver: result.maneuver };

    const hurt = (id: string, injury: number | undefined) => {
      if (!injury || injury <= 0) return;
      const fighter = fighters[id]!;
      fighters[id] = { ...fighter, character: applyDamage(fighter.character, injury, { now: at }) };
    };
    if (result.attack) {
      hurt(result.attack.targetId, result.attack.damage?.injury.injury);
      hurt(result.actorId, result.attack.selfInjury?.injury);
    }

    const standing = sidesStanding(fighters);
    if (standing.length <= 1) return { ...context, fighters, winner: standing[0] ?? null };

    const count = context.order.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (context.turnIndex + step) % count;
      if (!isDefeated(fighters[context.order[index]!]!)) {
        // Passing the end of the order, or coming back round to the same fighter, starts a new second.
        const wrapped = context.turnIndex + step >= count;
        return { ...context, fighters, turnIndex: index, round: context.round + (wrapped ? 1 : 0) };
      }
    }
    return { ...context, fighters };
  }

  /** Replaces one fighter's modifiers. Reducers can't throw on bad input after committing: the machine only commits once they return. */
  const withModifiers = (context: CombatContext, fighterId: string, change: (set: ModifierSet) => ModifierSet): CombatContext => {
    const fighter = fighterIn(context, fighterId);
    return { ...context, fighters: { ...context.fighters, [fighterId]: { ...fighter, modifiers: change(fighter.modifiers) } } };
  };

  const machine: Machine<CombatState, CombatContext, CombatEvent> = createMachine<CombatState, CombatContext, CombatEvent>({
    initial: 'in-progress',
    initialContext: startingContext,
    states: {
      'in-progress': {
        on: {
          RESOLVE_TURN: {
            guard: (context, event) => context.order[context.turnIndex] === event.result.actorId,
            assign: applyTurn,
            // Over when at most one side is left, which includes everyone falling together (no winner).
            target: (context) => (sidesStanding(context.fighters).length <= 1 ? 'finished' : 'in-progress'),
          },
          ADD_MODIFIER: {
            target: 'in-progress',
            assign: (context, { fighterId, modifier }) => withModifiers(context, fighterId, (set) => set.add(modifier).set),
          },
          UPDATE_MODIFIER: {
            target: 'in-progress',
            assign: (context, { fighterId, modifierId, patch }) =>
              withModifiers(context, fighterId, (set) => set.update(modifierId, patch)),
          },
          REMOVE_MODIFIER: {
            target: 'in-progress',
            assign: (context, { fighterId, modifierId }) => withModifiers(context, fighterId, (set) => set.remove(modifierId)),
          },
        },
      },
      finished: {},
    },
  });

  const assertOngoing = (): CombatContext => {
    const { state, context } = machine.snapshot();
    if (state === 'finished') throw new CombatError('The combat is over');
    return context;
  };

  /** The one place that decides what is legal; `takeTurn` accepts exactly these. */
  function legalActions(): TurnAction[] {
    const { state, context } = machine.snapshot();
    if (state === 'finished') return [];
    const actor = byId.get(context.order[context.turnIndex]!)!;
    const actions: TurnAction[] = [{ maneuver: 'do-nothing' }, { maneuver: 'all-out-defense' }];
    for (const attack of actor.attacks) {
      for (const target of roster) {
        if (target.side === actor.side || isDefeated(context.fighters[target.id]!)) continue;
        actions.push(
          { maneuver: 'attack', attackId: attack.id, targetId: target.id },
          { maneuver: 'all-out-attack', attackId: attack.id, targetId: target.id },
        );
      }
    }
    return actions;
  }

  /** Why an action isn't legal, for the error message only: legality itself is decided by `legalActions`. */
  function explainIllegal(actor: Combatant, action: TurnAction, context: CombatContext): string {
    if (!Object.hasOwn(MANEUVER_EFFECTS, action.maneuver)) return `Unknown maneuver "${action.maneuver}"`;
    if (!isAttackAction(action)) return `${actor.name} can't take ${action.maneuver} now`;
    if (!actor.attacks.some((option) => option.id === action.attackId)) return `${actor.name} has no attack "${action.attackId}"`;
    const target = byId.get(action.targetId);
    if (!target) return `Unknown target "${action.targetId}"`;
    if (target.side === actor.side) return `${actor.name} can't attack ${target.name}: same side`;
    if (isDefeated(context.fighters[target.id]!)) return `${target.name} is already down`;
    return `${actor.name} can't ${action.maneuver} ${target.name} with ${action.attackId} now`;
  }

  function takeTurn(action: TurnAction): TurnResult {
    const context = assertOngoing();
    const actor = byId.get(context.order[context.turnIndex]!)!;
    if (!legalActions().some((legal) => sameAction(legal, action))) {
      throw new CombatError(explainIllegal(actor, action, context));
    }

    const base = { round: context.round, actorId: actor.id, maneuver: action.maneuver };
    let result: TurnResult;
    if (isAttackAction(action)) {
      // Legal, so both the attack and the target exist.
      const attack = actor.attacks.find((option) => option.id === action.attackId)!;
      const target = byId.get(action.targetId)!;
      result = {
        ...base,
        attack: resolveAttack({
          dice,
          attackerState: context.fighters[actor.id]!,
          maneuver: action.maneuver,
          attack,
          target,
          targetState: context.fighters[target.id]!,
        }),
      };
    } else {
      result = { ...base, attack: null };
    }

    machine.send({ type: 'RESOLVE_TURN', result, at: clock() });
    return result;
  }

  /** Checks the fight is on and the fighter exists, so these refusals are `CombatError`s. */
  const checked = (fighterId: string): void => void fighterIn(assertOngoing(), fighterId);

  return {
    snapshot: machine.snapshot,
    legalActions,
    takeTurn,
    reset: machine.reset,

    view() {
      const { state, context } = machine.snapshot();
      return {
        status: state,
        round: context.round,
        currentId: state === 'finished' ? null : (context.order[context.turnIndex] ?? null),
        winner: context.winner,
        fighters: context.order.map((id): FighterView => {
          const combatant = byId.get(id)!;
          const fighter = context.fighters[id]!;
          return {
            id,
            name: combatant.name,
            side: combatant.side,
            hp: hpOf(fighter),
            dodge: combatant.dodge,
            dr: combatant.dr,
            maneuver: fighter.maneuver,
            defeated: isDefeated(fighter),
            attacks: combatant.attacks,
            modifiers: fighter.modifiers.list(),
          };
        }),
      };
    },

    sheetOf: (fighterId) => structuredClone(fighterIn(machine.snapshot().context, fighterId).character),

    addModifier(fighterId, modifier) {
      checked(fighterId);
      machine.send({ type: 'ADD_MODIFIER', fighterId, modifier });
      // Ids only ever grow, so the one just added is the last in the list.
      return fighterIn(machine.snapshot().context, fighterId).modifiers.list().at(-1)!;
    },
    updateModifier(fighterId, modifierId, patch) {
      checked(fighterId);
      machine.send({ type: 'UPDATE_MODIFIER', fighterId, modifierId, patch });
    },
    removeModifier(fighterId, modifierId) {
      checked(fighterId);
      machine.send({ type: 'REMOVE_MODIFIER', fighterId, modifierId });
    },
  };
}
