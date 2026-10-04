import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiceManager, turnOrder } from '../src/index.js';
import { scripted } from './fixtures.js';

const f = (id: string, basicSpeed: number, dx: number) => ({ id, basicSpeed, dx });

test('highest Basic Speed acts first, and no dice are rolled without a tie', () => {
  const dice = scripted();
  assert.deepEqual(turnOrder([f('slow', 5.25, 10), f('fast', 6.75, 10), f('mid', 6, 10)], dice), ['fast', 'mid', 'slow']);
  assert.equal(dice.history().length, 0);
});

test('equal speeds go to the higher DX', () => {
  assert.deepEqual(turnOrder([f('a', 6, 10), f('b', 6, 13), f('c', 6, 11)], scripted()), ['b', 'c', 'a']);
});

test('fighters tied on speed and DX are ordered by a roll, highest first', () => {
  assert.deepEqual(turnOrder([f('a', 6, 11), f('b', 6, 11)], scripted(2, 5)), ['b', 'a']);
});

test('a tied roll-off is re-rolled among only those still tied', () => {
  // First round: a=3, b=5, c=3. b wins; a and c tie and re-roll: a=1, c=6.
  assert.deepEqual(turnOrder([f('a', 6, 11), f('b', 6, 11), f('c', 6, 11)], scripted(3, 5, 3, 1, 6)), ['b', 'c', 'a']);
});

test('speed outranks everything, and each tie is resolved inside its own group', () => {
  const order = turnOrder([f('x1', 5, 10), f('fast', 7, 9), f('x2', 5, 10)], scripted(4, 2));
  assert.deepEqual(order, ['fast', 'x1', 'x2']);
});

test('a die source that can never break a tie ends in the given order instead of recursing forever', () => {
  const alwaysThree = createDiceManager({ source: { nextInt: () => 3 } });
  assert.deepEqual(turnOrder([f('a', 6, 11), f('b', 6, 11), f('c', 6, 11)], alwaysThree), ['a', 'b', 'c']);
  assert.ok(alwaysThree.history().length <= 3 * 20, 'the re-rolls are bounded');
});
