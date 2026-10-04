import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMachine, InvalidTransitionError, type MachineDefinition } from '../src/index.js';

type State = 'idle' | 'running' | 'over';
type Context = { round: number };
type Event = { type: 'START' } | { type: 'NEXT_ROUND'; by?: number } | { type: 'END' };

const definition = (): MachineDefinition<State, Context, Event> => ({
  initial: 'idle',
  initialContext: () => ({ round: 0 }),
  states: {
    idle: { on: { START: { target: 'running' } } },
    running: {
      on: {
        NEXT_ROUND: { target: 'running', assign: (ctx, event) => ({ round: ctx.round + (event.by ?? 1) }) },
        END: { target: 'over', guard: (ctx) => ctx.round > 0 },
      },
    },
    over: {},
  },
});

const makeMachine = () => createMachine(definition());

test('transitions update state, context and history', () => {
  const machine = makeMachine();
  machine.send({ type: 'START' });
  machine.send({ type: 'NEXT_ROUND', by: 2 });
  const snap = machine.send({ type: 'END' });
  assert.equal(snap.state, 'over');
  assert.equal(snap.context.round, 2);
  assert.deepEqual(
    snap.history.map((h) => `${h.from}->${h.to}`),
    ['idle->running', 'running->running', 'running->over'],
  );
});

test('illegal and guarded events are refused and change nothing', () => {
  const machine = makeMachine();
  assert.throws(() => machine.send({ type: 'END' }), InvalidTransitionError);
  machine.send({ type: 'START' });
  assert.equal(machine.can({ type: 'END' }), false, 'guard blocks END before round 1');
  assert.deepEqual(machine.eventTypes(), ['NEXT_ROUND', 'END']);
  assert.throws(() => machine.send({ type: 'END' }), /not allowed in state "running"/);
  assert.equal(machine.snapshot().state, 'running');
  assert.equal(machine.snapshot().history.length, 1);
});

test('snapshots are not changed by later events', () => {
  const machine = makeMachine();
  const before = machine.snapshot();
  machine.send({ type: 'START' });
  assert.equal(before.state, 'idle');
  assert.equal(before.history.length, 0);
});

test('reset restores the initial state with a fresh context', () => {
  const machine = makeMachine();
  machine.send({ type: 'START' });
  machine.send({ type: 'NEXT_ROUND' });
  machine.reset();
  const snap = machine.snapshot();
  assert.equal(snap.state, 'idle');
  assert.deepEqual(snap.context, { round: 0 });
  assert.deepEqual(snap.history, []);
});

test('a transition can choose its target from the context after assign', () => {
  type Phase = 'counting' | 'done';
  type Tick = { type: 'TICK' };
  const machine = createMachine<Phase, { n: number }, Tick>({
    initial: 'counting',
    initialContext: () => ({ n: 0 }),
    states: {
      counting: { on: { TICK: { assign: (ctx) => ({ n: ctx.n + 1 }), target: (ctx) => (ctx.n >= 2 ? 'done' : 'counting') } } },
      done: {},
    },
  });
  assert.equal(machine.send({ type: 'TICK' }).state, 'counting');
  const last = machine.send({ type: 'TICK' });
  assert.equal(last.state, 'done', 'the target saw the updated count');
  assert.deepEqual(last.history.map((h) => h.to), ['counting', 'done']);
});

test('a computed target that names an unknown state throws and commits nothing', () => {
  const machine = createMachine<'a' | 'b', { n: number }, { type: 'GO' }>({
    initial: 'a',
    initialContext: () => ({ n: 0 }),
    states: { a: { on: { GO: { assign: (ctx) => ({ n: ctx.n + 1 }), target: () => 'nowhere' as 'b' } } }, b: {} },
  });
  assert.throws(() => machine.send({ type: 'GO' }), /unknown state "nowhere"/);
  assert.deepEqual(machine.snapshot(), { state: 'a', context: { n: 0 }, history: [] });
});

test('a definition pointing at an unknown state is rejected up front', () => {
  const broken = definition();
  assert.throws(
    () =>
      createMachine({
        ...broken,
        states: {
          ...broken.states,
          // @ts-expect-error 'zzz' is not a declared state: the compiler catches this too.
          idle: { on: { START: { target: 'zzz' } } },
        },
      }),
    /unknown state "zzz"/,
  );
  // @ts-expect-error 'missing' is not a declared state.
  assert.throws(() => createMachine({ ...broken, initial: 'missing' }), /not defined/);
});

test('state names that exist on every object are not states', () => {
  assert.throws(() => createMachine({ ...definition(), initial: 'toString' as State }), /not defined/);

  const machine = createMachine<'a' | 'b', { n: number }, { type: 'GO' }>({
    initial: 'a',
    initialContext: () => ({ n: 0 }),
    states: { a: { on: { GO: { assign: (ctx) => ({ n: ctx.n + 1 }), target: () => 'toString' as 'b' } } }, b: {} },
  });
  assert.throws(() => machine.send({ type: 'GO' }), /unknown state "toString"/);
  assert.deepEqual(machine.snapshot(), { state: 'a', context: { n: 0 }, history: [] });
});
