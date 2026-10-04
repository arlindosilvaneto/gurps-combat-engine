import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiceManager,
  createTable,
  parseNotation,
  scriptedSource,
  seededSource,
  type TableEntry,
} from '../src/index.js';

test('parseNotation understands GURPS shorthand', () => {
  assert.deepEqual(parseNotation('3d'), { count: 3, sides: 6, modifier: 0 });
  assert.deepEqual(parseNotation('2d+1'), { count: 2, sides: 6, modifier: 1 });
  assert.deepEqual(parseNotation('1d10-2'), { count: 1, sides: 10, modifier: -2 });
  assert.throws(() => parseNotation('banana'), /Invalid dice notation/);
  assert.throws(() => parseNotation('0d6'), /at least one die/);
  assert.throws(() => parseNotation('1d1'), /at least 2 sides/);
});

test('scripted source makes rolls exact and fails loudly when misused', () => {
  const source = scriptedSource([6, 5, 4, 3]);
  const dice = createDiceManager({ source });
  assert.deepEqual(dice.roll('3d'), { notation: '3d', dice: [6, 5, 4], modifier: 0, total: 15 });
  assert.equal(dice.roll('1d+2').total, 5);
  assert.equal(source.remaining, 0);
  assert.throws(() => dice.roll('1d'), /exhausted/);
  assert.throws(() => createDiceManager({ source: scriptedSource([7]) }).roll('1d'), /not valid on a d6/);
});

test('seeded source is reproducible and stays on the die', () => {
  const run = (seed: number) => {
    const dice = createDiceManager({ source: seededSource(seed) });
    return Array.from({ length: 50 }, () => dice.roll('3d').total);
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43));
  assert.ok(run(42).every((total) => total >= 3 && total <= 18));
});

test('history records every roll, and recorded rolls cannot be altered', () => {
  const dice = createDiceManager({ source: scriptedSource([1, 2]) });
  dice.roll('1d');
  const second = dice.roll('1d');
  const history = dice.history();
  assert.equal(history.length, 2);
  assert.equal(history[1], second);
  assert.throws(() => (history[0]!.dice as number[]).push(99), TypeError);
  assert.deepEqual(dice.history()[0]?.dice, [1]);
});

const hitLocation = createTable({
  name: 'toy hit location',
  dice: '1d',
  entries: [
    { min: 1, max: 2, result: 'head' },
    { min: 3, max: 5, result: 'torso' },
    { min: 6, max: 6, result: 'leg' },
  ],
});

test('rollOnTable resolves the rolled total through the table', () => {
  const dice = createDiceManager({ source: scriptedSource([4, 6, 1]) });
  assert.equal(dice.rollOnTable(hitLocation).entry.result, 'torso');
  assert.equal(dice.rollOnTable(hitLocation).entry.result, 'leg');
  assert.equal(dice.rollOnTable(hitLocation).entry.result, 'head');
});

test('createTable rejects gaps, overlaps and incomplete coverage', () => {
  const entries = (...ranges: Array<[number, number]>): TableEntry<number>[] =>
    ranges.map(([min, max], result) => ({ min, max, result }));
  assert.throws(() => createTable({ name: 'gap', dice: '1d', entries: entries([1, 2], [4, 6]) }), /gap or overlap/);
  assert.throws(() => createTable({ name: 'overlap', dice: '1d', entries: entries([1, 3], [3, 6]) }), /gap or overlap/);
  assert.throws(() => createTable({ name: 'short', dice: '1d', entries: entries([1, 5]) }), /must cover 1-6/);
  assert.throws(() => createTable({ name: 'late', dice: '1d', entries: entries([2, 6]) }), /gap or overlap/);
  assert.throws(() => createTable({ name: 'inverted', dice: '1d', entries: entries([1, 0], [1, 6]) }), /inverted/);
});

test('createTable honours dice modifiers when computing the range', () => {
  const table = createTable({ name: 'shifted', dice: '1d+2', entries: [{ min: 3, max: 8, result: 'any' }] });
  assert.equal(table.entries.length, 1);
});
