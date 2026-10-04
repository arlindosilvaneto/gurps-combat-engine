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
