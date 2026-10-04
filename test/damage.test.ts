import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWoundingType, resolveInjury, rollDamage, woundingMultiplier } from '../src/index.js';
import { scripted } from './fixtures.js';

test('wounding modifiers follow the Basic Set (p.379)', () => {
  assert.equal(woundingMultiplier('pi-'), 0.5);
  for (const type of ['burn', 'cor', 'cr', 'pi'] as const) assert.equal(woundingMultiplier(type), 1);
  assert.equal(woundingMultiplier('cut'), 1.5);
  assert.equal(woundingMultiplier('pi+'), 1.5);
  assert.equal(woundingMultiplier('imp'), 2);
  assert.equal(woundingMultiplier('pi++'), 2);
});

test('isWoundingType accepts modelled types only', () => {
  assert.equal(isWoundingType('cut'), true);
  for (const type of ['fat', 'tox', 'tbb', 'aff', 'spec', 'toString', undefined]) assert.equal(isWoundingType(type), false);
});

test('the book examples: sword 8 vs DR 3 and Pierre\'s axe (p.378-379)', () => {
  // "basic damage 2d+1 cutting ... 8 ... DR 3 ... 5 penetrating ... x1.5 ... 7 points of injury"
  assert.deepEqual(resolveInjury({ basic: 8, dr: 3, type: 'cut' }), { basic: 8, dr: 3, penetrating: 5, multiplier: 1.5, injury: 7 });
  // "basic damage roll is 7 ... DR 2 ... 5 penetrating ... 7.5 HP, which rounds to 7"
  assert.equal(resolveInjury({ basic: 7, dr: 2, type: 'cut' }).injury, 7);
});

test('DR stopping the whole hit means no injury', () => {
  assert.equal(resolveInjury({ basic: 4, dr: 4, type: 'imp' }).injury, 0);
  assert.equal(resolveInjury({ basic: 3, dr: 10, type: 'cut' }).penetrating, 0);
});

test('anything that penetrates does at least 1 HP, even after rounding down', () => {
  assert.equal(resolveInjury({ basic: 1, dr: 0, type: 'pi-' }).injury, 1, '1 x 0.5 rounds to 0, minimum 1');
  assert.equal(resolveInjury({ basic: 3, dr: 0, type: 'pi-' }).injury, 1, '1.5 rounds down to 1');
  assert.equal(resolveInjury({ basic: 5, dr: 0, type: 'pi-' }).injury, 2);
});

test('negative DR is treated as none', () => {
  assert.equal(resolveInjury({ basic: 5, dr: -3, type: 'cr' }).penetrating, 5);
});

test('damage rolls can\'t go below 0 (crushing) or 1 (other types) (p.378)', () => {
  assert.equal(rollDamage(scripted(1), '1d-3', 'cr').basic, 0);
  assert.equal(rollDamage(scripted(1), '1d-3', 'cut').basic, 1);
  const roll = rollDamage(scripted(1), '1d-3', 'cr');
  assert.equal(roll.roll.total, -2, 'the dice are recorded as rolled');
  assert.equal(rollDamage(scripted(5, 4), '2d+1', 'cut').basic, 10);
});
