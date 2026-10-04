/**
 * Minimal finite state machine that holds the whole combat for one run.
 * It knows nothing about GURPS: rules plug in as states, guards and `assign`
 * reducers. Context is treated as immutable, so snapshots stay valid.
 *
 * Type parameters: `S` the state names, `C` the context, `E` the event union
 * (discriminated by `type`).
 */
export interface MachineEvent {
  readonly type: string;
}

/** The member of the event union `E` whose `type` is `T`. */
export type EventOf<E extends MachineEvent, T extends E['type']> = Extract<E, { type: T }>;

export interface Transition<S extends string, C, E extends MachineEvent> {
  readonly target: S;
  /** The transition is only available while this returns true. */
  readonly guard?: (context: C, event: E) => boolean;
  /** Returns the next context; must not mutate the current one. */
  readonly assign?: (context: C, event: E) => C;
}

export interface StateDefinition<S extends string, C, E extends MachineEvent> {
  /** Transitions by event type; each one receives that event's own narrowed type. */
  readonly on?: { readonly [T in E['type']]?: Transition<S, C, EventOf<E, T>> };
}

export interface MachineDefinition<S extends string, C, E extends MachineEvent> {
  readonly initial: S;
  /** Every state must be listed, even terminal ones (use `{}`). */
  readonly states: Readonly<Record<S, StateDefinition<S, C, E>>>;
  /** A factory, so `reset()` never reuses state from a previous run. */
  readonly initialContext: () => C;
}

export interface HistoryEntry<S extends string, E extends MachineEvent> {
  readonly from: S;
  readonly to: S;
  readonly event: E;
}

export interface Snapshot<S extends string, C, E extends MachineEvent> {
  readonly state: S;
  readonly context: C;
  readonly history: readonly HistoryEntry<S, E>[];
}

export interface Machine<S extends string, C, E extends MachineEvent> {
  snapshot(): Snapshot<S, C, E>;
  /** Event types defined for the current state, ignoring guards. */
  eventTypes(): E['type'][];
  /** Whether `event` is defined for the current state and its guard passes. */
  can(event: E): boolean;
  /** Applies `event`, or throws `InvalidTransitionError` and changes nothing. */
  send(event: E): Snapshot<S, C, E>;
  /** Back to the initial state with a fresh context and an empty history. */
  reset(): void;
}

export class InvalidTransitionError extends Error {
  readonly state: string;
  readonly eventType: string;

  constructor(state: string, eventType: string) {
    super(`Event "${eventType}" is not allowed in state "${state}"`);
    this.name = 'InvalidTransitionError';
    this.state = state;
    this.eventType = eventType;
  }
}

export function createMachine<S extends string, C, E extends MachineEvent>(
  definition: MachineDefinition<S, C, E>,
): Machine<S, C, E> {
  const { initial, states, initialContext } = definition;
  assertWellFormed(definition);

  let state: S = initial;
  let context: C = initialContext();
  let history: HistoryEntry<S, E>[] = [];

  const snapshot = (): Snapshot<S, C, E> => ({ state, context, history: [...history] });

  function find(event: E): Transition<S, C, E> | undefined {
    // The mapped `on` type pairs each event type with its narrowed transition,
    // so looking one up by `event.type` is safe; TypeScript can't see that pairing.
    const transition = states[state].on?.[event.type as E['type']] as Transition<S, C, E> | undefined;
    return transition && (transition.guard?.(context, event) ?? true) ? transition : undefined;
  }

  return {
    snapshot,
    eventTypes: () => Object.keys(states[state].on ?? {}) as E['type'][],
    can: (event) => find(event) !== undefined,
    send(event) {
      const transition = find(event);
      if (!transition) throw new InvalidTransitionError(state, event.type);
      const from = state;
      context = transition.assign ? transition.assign(context, event) : context;
      state = transition.target;
      history.push({ from, to: state, event });
      return snapshot();
    },
    reset() {
      state = initial;
      context = initialContext();
      history = [];
    },
  };
}

/** Catches what the types can't when a definition is built dynamically (or from JS). */
function assertWellFormed<S extends string, C, E extends MachineEvent>({
  initial,
  states,
}: MachineDefinition<S, C, E>): void {
  if (!(initial in states)) throw new RangeError(`Initial state "${initial}" is not defined`);
  for (const [name, definition] of Object.entries<StateDefinition<S, C, E>>(states)) {
    const transitions = Object.entries(definition.on ?? {}) as Array<[string, Transition<S, C, E> | undefined]>;
    for (const [type, transition] of transitions) {
      if (transition && !(transition.target in states)) {
        throw new RangeError(`State "${name}" event "${type}" targets unknown state "${transition.target}"`);
      }
    }
  }
}
