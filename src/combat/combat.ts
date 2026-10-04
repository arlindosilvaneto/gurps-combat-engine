import { applyDamage, getPool, type GurpsCharacter, type Pool } from '@gurps-sheet/character';
import type { DiceManager } from '../dice/dice-manager.js';
import { ModifierSet, type Modifier, type ModifierPatch, type NewModifier } from '../modifiers/modifier-set.js';
import { createMachine, type Machine, type Snapshot, type Transition } from '../machine/machine.js';
import { isMajorWound, knockdownOutcome, MAX_SHOCK, shockPenalty } from '../rules/injury.js';
import { rollSuccess, type SuccessRollResult } from '../rules/success-roll.js';
import { rollAttack, rollHit } from './attack.js';
import type { AttackOption, Combatant, ParryOption } from './combatant.js';
import { defenseOptions, NO_DEFENSE, rollDefense, sameDefense } from './defense.js';
import { MANEUVER_EFFECTS, type DefenseKind, type Maneuver } from './maneuvers.js';
import { turnOrder } from './turn-order.js';
import {
  isAttackAction,
  ROLL_TAGS,
  type AttackResult,
  type Conditions,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type DefenseChoice,
  type DefenseOption,
  type DefenseResult,
  type DefenseUse,
  type FighterState,
  type InjuryEffects,
  type PendingAttack,
  type TurnAction,
  type TurnResult,
  type TurnStep,
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
  readonly parries: readonly ParryOption[];
  readonly block: number | null;
  readonly dr: number;
  readonly maneuver: Maneuver;
  /** The defense its All-Out Defense raised, if that is its current maneuver. */
  readonly increased: DefenseKind | null;
  readonly ht: number;
  /** Shock, stun and unconsciousness, tracked by the engine. */
  readonly conditions: Conditions;
  /** Out of the fight: 0 HP or less (the HT rolls to stay up aren't modelled yet), or unconscious. */
  readonly defeated: boolean;
  readonly attacks: readonly AttackOption[];
  readonly modifiers: readonly Modifier[];
}

export interface CombatView {
  readonly status: CombatState;
  readonly round: number;
  /** Whose turn it is, or null once the fight is over. */
  readonly currentId: string | null;
  /** Who must decide next: the fighter whose turn it is, or the defender of a pending attack. Null once over. */
  readonly awaitingId: string | null;
  /** The attack waiting for a defense, while `status` is `awaiting-defense`. */
  readonly pending: PendingAttack | null;
  /** The side left standing, once the fight is over. None if the last fighters fell together. */
  readonly winner: string | null;
  /** Fighters in turn order. */
  readonly fighters: readonly FighterView[];
}

export interface Combat {
  view(): CombatView;
  /** The raw machine state and history, for logging or replay. Every event in the history is plain data. */
  snapshot(): Snapshot<CombatState, CombatContext, CombatEvent>;
  /** Every action the current fighter may take right now (none while a defense is pending). `takeTurn` accepts exactly these. */
  legalActions(): readonly TurnAction[];
  /**
   * Plays the current fighter's action. Returns the finished turn, or, when an attack hits a
   * fighter who has a defense to choose, the pending attack: call `defend` to finish the turn.
   * Throws `CombatError` if the action isn't legal.
   */
  takeTurn(action: TurnAction): TurnStep;
  /** The defenses the defender of the pending attack may choose, `none` last. Empty when nothing is pending. */
  legalDefenses(): readonly DefenseOption[];
  /** Finishes the pending attack with the defender's choice. Throws `CombatError` if the choice isn't legal. */
  defend(choice: DefenseChoice): TurnResult;
  /**
   * A fighter's sheet as it stands now, current HP included: for showing an NPC (or anyone) mid-fight.
   * It's a copy, so changing it changes nothing in the fight. Throws `CombatError` for an unknown fighter.
   */
  sheetOf(fighterId: string): GurpsCharacter;
  /** Throw `CombatError` once the fight is over or for an unknown fighter. */
  addModifier(fighterId: string, modifier: NewModifier): Modifier;
  updateModifier(fighterId: string, modifierId: string, patch: ModifierPatch): void;
  removeModifier(fighterId: string, modifierId: string): void;
  /**
   * Starts the same fight over: each fighter's HP is restored from the sheet it started with
   * (not necessarily full HP), maneuvers and modifiers are cleared, and the tie-break is re-rolled.
   */
  reset(): void;
}

const FRESH_DEFENSES: DefenseUse = { parries: {}, blocked: false, retreated: false };
const FRESH_CONDITIONS: Conditions = { shock: 0, stun: 'none', unconscious: false };

const hpOf = (fighter: FighterState): Pool => getPool(fighter.character, 'hp');
const isDefeated = (fighter: FighterState): boolean => fighter.conditions.unconscious || hpOf(fighter).current <= 0;

/**
 * A fighter's conditions once its own turn is over: its shock was spent on this turn (p.419),
 * a stunned fighter that made its HT roll is now recovering, and one that was recovering
 * defends normally again (pp.364, 420).
 */
function afterOwnTurn(conditions: Conditions, recovery: SuccessRollResult | null): Conditions {
  const stun = conditions.stun === 'stunned' ? (recovery?.success ? 'recovering' : 'stunned') : 'none';
  return { ...conditions, shock: 0, stun };
}

/** A fighter's conditions after an injury: more shock (at most 4), and a failed knockdown roll's stun or unconsciousness. */
function afterInjury(conditions: Conditions, effects: InjuryEffects | null): Conditions {
  if (!effects) return conditions;
  return {
    shock: Math.min(MAX_SHOCK, conditions.shock + effects.shock),
    stun: effects.knockdown === 'stunned' ? 'stunned' : conditions.stun,
    unconscious: conditions.unconscious || effects.knockdown === 'unconscious',
  };
}

const sameAction = (a: TurnAction, b: TurnAction): boolean =>
  a.maneuver === b.maneuver &&
  (a.maneuver !== 'all-out-defense' || (b.maneuver === 'all-out-defense' && a.increase === b.increase)) &&
  (!isAttackAction(a) || (isAttackAction(b) && a.attackId === b.attackId && a.targetId === b.targetId));

/** The defense use a defender has after this one: limits that count per turn (pp.375-377). */
function useDefense(use: DefenseUse, choice: DefenseChoice): DefenseUse {
  if (choice.kind === 'none') return use;
  return {
    parries: choice.kind === 'parry' ? { ...use.parries, [choice.parryId]: (use.parries[choice.parryId] ?? 0) + 1 } : use.parries,
    blocked: use.blocked || choice.kind === 'block',
    retreated: use.retreated || choice.retreat,
  };
}

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
      roster.map((c): [string, FighterState] => [
        c.id,
        {
          character: c.character,
          maneuver: 'do-nothing',
          increased: null,
          attackedWith: null,
          defenseUse: FRESH_DEFENSES,
          conditions: FRESH_CONDITIONS,
          modifiers: new ModifierSet(),
        },
      ]),
    );
    return { round: 1, order, turnIndex: order.findIndex((id) => !isDefeated(fighters[id]!)), fighters, pending: null, winner: null };
  }

  const fighterIn = (context: CombatContext, id: string): FighterState => {
    if (!Object.hasOwn(context.fighters, id)) throw new CombatError(`Unknown combatant "${id}"`);
    return context.fighters[id]!;
  };

  const attackOf = (pending: PendingAttack): AttackOption =>
    byId.get(pending.actorId)!.attacks.find((attack) => attack.id === pending.attackId)!;

  /**
   * Applies a resolved turn: the actor starts a new turn (maneuver, a fresh set of per-turn
   * defenses, the weapon it attacked with, its shock spent and its stun moved on), the
   * defender spends its defense, both take any injury and its effects, and play passes to
   * the next fighter standing.
   */
  function applyTurn(context: CombatContext, { result, at }: Extract<CombatEvent, { type: 'RESOLVE_TURN' }>): CombatContext {
    const fighters: Record<string, FighterState> = { ...context.fighters };
    const attack = result.attack;
    const weapon = attack ? (byId.get(result.actorId)!.attacks.find((option) => option.id === attack.attackId)?.weapon ?? null) : null;
    const actorState = fighters[result.actorId]!;
    fighters[result.actorId] = {
      ...actorState,
      maneuver: result.maneuver,
      increased: result.increase,
      attackedWith: weapon,
      defenseUse: FRESH_DEFENSES,
      conditions: afterOwnTurn(actorState.conditions, result.recovery),
    };

    const hurt = (id: string, injury: number | undefined, effects: InjuryEffects | null) => {
      if (!injury || injury <= 0) return;
      const fighter = fighters[id]!;
      fighters[id] = {
        ...fighter,
        character: applyDamage(fighter.character, injury, { now: at }),
        conditions: afterInjury(fighter.conditions, effects),
      };
    };
    if (attack) {
      if (attack.defense) {
        const target = fighters[attack.targetId]!;
        fighters[attack.targetId] = { ...target, defenseUse: useDefense(target.defenseUse, attack.defense.choice) };
      }
      hurt(attack.targetId, attack.damage?.injury.injury, attack.targetEffects);
      hurt(result.actorId, attack.selfInjury?.injury, attack.attackerEffects);
    }

    const standing = sidesStanding(fighters);
    if (standing.length <= 1) return { ...context, fighters, pending: null, winner: standing[0] ?? null };

    const count = context.order.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (context.turnIndex + step) % count;
      if (!isDefeated(fighters[context.order[index]!]!)) {
        // Passing the end of the order, or coming back round to the same fighter, starts a new second.
        const wrapped = context.turnIndex + step >= count;
        return { ...context, fighters, pending: null, turnIndex: index, round: context.round + (wrapped ? 1 : 0) };
      }
    }
    return { ...context, fighters, pending: null };
  }

  /** Replaces one fighter's modifiers. The machine commits only once this returns, so a bad id changes nothing. */
  const withModifiers = (context: CombatContext, fighterId: string, change: (set: ModifierSet) => ModifierSet): CombatContext => {
    const fighter = fighterIn(context, fighterId);
    return { ...context, fighters: { ...context.fighters, [fighterId]: { ...fighter, modifiers: change(fighter.modifiers) } } };
  };

  // Over when at most one side is left, which includes everyone falling together (no winner).
  const afterTurn = (context: CombatContext): CombatState => (sidesStanding(context.fighters).length <= 1 ? 'finished' : 'in-progress');

  /** Modifier changes are allowed whenever the fight is on, and leave the state as it was. */
  const modifierTransitions = (state: CombatState) => ({
    ADD_MODIFIER: {
      target: state,
      assign: (context, { fighterId, modifier }) => withModifiers(context, fighterId, (set) => set.add(modifier).set),
    } satisfies Transition<CombatState, CombatContext, Extract<CombatEvent, { type: 'ADD_MODIFIER' }>>,
    UPDATE_MODIFIER: {
      target: state,
      assign: (context, { fighterId, modifierId, patch }) => withModifiers(context, fighterId, (set) => set.update(modifierId, patch)),
    } satisfies Transition<CombatState, CombatContext, Extract<CombatEvent, { type: 'UPDATE_MODIFIER' }>>,
    REMOVE_MODIFIER: {
      target: state,
      assign: (context, { fighterId, modifierId }) => withModifiers(context, fighterId, (set) => set.remove(modifierId)),
    } satisfies Transition<CombatState, CombatContext, Extract<CombatEvent, { type: 'REMOVE_MODIFIER' }>>,
  });

  const machine: Machine<CombatState, CombatContext, CombatEvent> = createMachine<CombatState, CombatContext, CombatEvent>({
    initial: 'in-progress',
    initialContext: startingContext,
    states: {
      'in-progress': {
        on: {
          RESOLVE_TURN: {
            guard: (context, event) => context.order[context.turnIndex] === event.result.actorId,
            assign: applyTurn,
            target: afterTurn,
          },
          AWAIT_DEFENSE: {
            guard: (context, event) => context.order[context.turnIndex] === event.pending.actorId,
            assign: (context, { pending }) => ({ ...context, pending }),
            target: 'awaiting-defense',
          },
          ...modifierTransitions('in-progress'),
        },
      },
      'awaiting-defense': {
        on: {
          RESOLVE_TURN: {
            guard: (context, { result }) =>
              context.pending?.actorId === result.actorId && context.pending.targetId === result.attack?.targetId,
            assign: applyTurn,
            target: afterTurn,
          },
          ...modifierTransitions('awaiting-defense'),
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

  /** The one place that decides which actions are legal; `takeTurn` accepts exactly these. */
  function legalActions(): TurnAction[] {
    const { state, context } = machine.snapshot();
    if (state !== 'in-progress') return [];
    const actor = byId.get(context.order[context.turnIndex]!)!;
    // A stunned fighter must Do Nothing (p.364).
    if (context.fighters[actor.id]!.conditions.stun === 'stunned') return [{ maneuver: 'do-nothing' }];
    // All-Out Defense can raise any defense the fighter actually has.
    const raisable: DefenseKind[] = ['dodge'];
    if (actor.parries.length > 0) raisable.push('parry');
    if (actor.block !== null) raisable.push('block');
    const actions: TurnAction[] = [
      { maneuver: 'do-nothing' },
      ...raisable.map((increase): TurnAction => ({ maneuver: 'all-out-defense', increase })),
    ];
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
    if (context.fighters[actor.id]!.conditions.stun === 'stunned') return `${actor.name} is stunned and can only Do Nothing`;
    if (action.maneuver === 'all-out-defense') return `${actor.name} can't raise "${action.increase}" with All-Out Defense`;
    if (!isAttackAction(action)) return `${actor.name} can't take ${action.maneuver} now`;
    if (!actor.attacks.some((option) => option.id === action.attackId)) return `${actor.name} has no attack "${action.attackId}"`;
    const target = byId.get(action.targetId);
    if (!target) return `Unknown target "${action.targetId}"`;
    if (target.side === actor.side) return `${actor.name} can't attack ${target.name}: same side`;
    if (isDefeated(context.fighters[target.id]!)) return `${target.name} is already down`;
    return `${actor.name} can't ${action.maneuver} ${target.name} with ${action.attackId} now`;
  }

  /** Records the finished attack turn and passes play on. */
  function finish(pending: PendingAttack, rest: Omit<AttackResult, 'targetId' | 'attackId' | 'attackRoll'>): TurnResult {
    const result: TurnResult = {
      round: pending.round,
      actorId: pending.actorId,
      maneuver: pending.maneuver,
      increase: null,
      attack: { targetId: pending.targetId, attackId: pending.attackId, attackRoll: pending.attackRoll, ...rest },
      recovery: null,
    };
    machine.send({ type: 'RESOLVE_TURN', result, at: clock() });
    return result;
  }

  /**
   * Shock and major-wound effects of an injury (pp.380, 419-420). A major wound calls for an
   * HT roll, made here, outside the reducer, like every roll. An injury that leaves the victim
   * at 0 HP or below puts it out of the fight anyway, so no knockdown roll is made for it.
   */
  function injuryEffects(id: string, injury: number, context: CombatContext): InjuryEffects | null {
    if (injury <= 0) return null;
    const state = context.fighters[id]!;
    const { current, max } = hpOf(state);
    const majorWound = isMajorWound(injury, max);
    const knockdownRoll =
      majorWound && current - injury > 0 && !state.conditions.unconscious
        ? rollSuccess(dice, { skill: byId.get(id)!.ht, modifiers: state.modifiers, tags: [ROLL_TAGS.ht] })
        : null;
    return { shock: shockPenalty(injury, max), majorWound, knockdownRoll, knockdown: knockdownRoll ? knockdownOutcome(knockdownRoll) : 'none' };
  }

  /** Rolls a hit's damage and its effects, and finishes the turn. */
  function finishHit(pending: PendingAttack, criticalHit: boolean, defense: DefenseResult | null): TurnResult {
    const { damage, selfInjury } = rollHit(dice, attackOf(pending), byId.get(pending.targetId)!);
    const { context } = machine.snapshot();
    const targetEffects = injuryEffects(pending.targetId, damage.injury.injury, context);
    const attackerEffects = injuryEffects(pending.actorId, selfInjury?.injury ?? 0, context);
    return finish(pending, { criticalHit, defense, outcome: 'hit', damage, selfInjury, targetEffects, attackerEffects });
  }

  function takeTurn(action: TurnAction): TurnStep {
    const { state, context } = machine.snapshot();
    if (state === 'finished') throw new CombatError('The combat is over');
    if (state === 'awaiting-defense') {
      throw new CombatError(`Waiting for ${byId.get(context.pending!.targetId)!.name} to choose a defense`);
    }
    const actor = byId.get(context.order[context.turnIndex]!)!;
    if (!legalActions().some((legal) => sameAction(legal, action))) {
      throw new CombatError(explainIllegal(actor, action, context));
    }

    if (!isAttackAction(action)) {
      // A stunned fighter (who can only Do Nothing) rolls HT at the end of its turn to recover (p.364).
      const actorState = context.fighters[actor.id]!;
      const recovery =
        actorState.conditions.stun === 'stunned'
          ? rollSuccess(dice, { skill: actor.ht, modifiers: actorState.modifiers, tags: [ROLL_TAGS.ht] })
          : null;
      const result: TurnResult = {
        round: context.round,
        actorId: actor.id,
        maneuver: action.maneuver,
        increase: action.maneuver === 'all-out-defense' ? action.increase : null,
        attack: null,
        recovery,
      };
      machine.send({ type: 'RESOLVE_TURN', result, at: clock() });
      return { status: 'resolved', result };
    }

    // Legal, so both the attack and the target exist.
    const attack = actor.attacks.find((option) => option.id === action.attackId)!;
    const target = byId.get(action.targetId)!;
    const attackRoll = rollAttack(dice, context.fighters[actor.id]!, action.maneuver, attack);
    const pending: PendingAttack = {
      round: context.round,
      actorId: actor.id,
      maneuver: action.maneuver,
      attackId: attack.id,
      targetId: target.id,
      attackRoll,
    };

    if (!attackRoll.success) {
      const missed = { criticalHit: false, defense: null, outcome: 'miss', damage: null, selfInjury: null, targetEffects: null, attackerEffects: null } as const;
      return { status: 'resolved', result: finish(pending, missed) };
    }
    // A critical hit can't be defended against (p.374), and neither can anyone without a legal defense.
    const criticalHit = attackRoll.outcome === 'critical-success';
    if (criticalHit || defenseOptions(target, context.fighters[target.id]!, attack).length === 0) {
      return { status: 'resolved', result: finishHit(pending, criticalHit, null) };
    }
    machine.send({ type: 'AWAIT_DEFENSE', pending });
    return { status: 'awaiting-defense', pending };
  }

  function legalDefenses(): DefenseOption[] {
    const { state, context } = machine.snapshot();
    if (state !== 'awaiting-defense' || !context.pending) return [];
    const { pending } = context;
    return [...defenseOptions(byId.get(pending.targetId)!, context.fighters[pending.targetId]!, attackOf(pending)), NO_DEFENSE];
  }

  function defend(choice: DefenseChoice): TurnResult {
    const { state, context } = machine.snapshot();
    if (state !== 'awaiting-defense' || !context.pending) throw new CombatError('No attack is waiting for a defense');
    const { pending } = context;
    const target = byId.get(pending.targetId)!;
    if (!legalDefenses().some((option) => sameDefense(option.choice, choice))) {
      throw new CombatError(`${target.name} can't use that defense now`);
    }
    if (choice.kind === 'none') return finishHit(pending, false, { choice, roll: null });

    const roll = rollDefense(dice, choice, target, context.fighters[target.id]!, attackOf(pending));
    if (roll.success) {
      return finish(pending, {
        criticalHit: false,
        defense: { choice, roll },
        outcome: 'defended',
        damage: null,
        selfInjury: null,
        targetEffects: null,
        attackerEffects: null,
      });
    }
    return finishHit(pending, false, { choice, roll });
  }

  /** Checks the fight is on and the fighter exists, so these refusals are `CombatError`s. */
  const checked = (fighterId: string): void => void fighterIn(assertOngoing(), fighterId);

  return {
    snapshot: machine.snapshot,
    legalActions,
    takeTurn,
    legalDefenses,
    defend,
    reset: machine.reset,

    view() {
      const { state, context } = machine.snapshot();
      const currentId = state === 'finished' ? null : (context.order[context.turnIndex] ?? null);
      return {
        status: state,
        round: context.round,
        currentId,
        awaitingId: state === 'awaiting-defense' ? (context.pending?.targetId ?? null) : currentId,
        pending: state === 'awaiting-defense' ? context.pending : null,
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
            parries: combatant.parries,
            block: combatant.block,
            dr: combatant.dr,
            maneuver: fighter.maneuver,
            increased: fighter.increased,
            ht: combatant.ht,
            conditions: fighter.conditions,
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
