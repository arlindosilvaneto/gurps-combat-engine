import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierSet } from '../src/index.js';

test('modifiers can be added, changed and removed without mutating earlier sets', () => {
  const empty = new ModifierSet();
  const { set: withShock, modifier: shock } = empty.add({ label: 'Shock', value: -2, appliesTo: ['attack'] });
  const { set: withBoth } = withShock.add({ label: 'Bless', value: 1 });

  assert.equal(withBoth.total(['attack']), -1);
  assert.equal(withBoth.total(['defense']), 1);
  assert.equal(withBoth.total(), 1);

  const changed = withBoth.update(shock.id, { value: -4 });
  assert.equal(changed.total(['attack']), -3);
  assert.equal(withBoth.total(['attack']), -1, 'previous set is untouched');

  const removed = changed.remove(shock.id);
  assert.equal(removed.total(['attack']), 1);
  assert.equal(removed.list().length, 1);
  assert.equal(empty.list().length, 0);
});

test('update changes only the fields it is given', () => {
  const { set, modifier } = new ModifierSet().add({ label: 'Shock', value: -2, appliesTo: ['attack'] });
  const relabelled = set.update(modifier.id, { label: 'Heavy shock', value: undefined });
  assert.deepEqual(relabelled.get(modifier.id), { id: modifier.id, label: 'Heavy shock', value: -2, appliesTo: ['attack'] });
});

test('ids stay unique after removals', () => {
  const { set: one, modifier: first } = new ModifierSet().add({ label: 'a', value: 1 });
  const { modifier: second } = one.remove(first.id).add({ label: 'b', value: 1 });
  assert.notEqual(first.id, second.id);
});

test('unknown ids and non-finite values are rejected', () => {
  const set = new ModifierSet();
  assert.throws(() => set.remove('nope'), /Unknown modifier/);
  assert.throws(() => set.update('nope', { value: 1 }), /Unknown modifier/);
  assert.throws(() => set.add({ label: 'bad', value: Number.NaN }), /finite/);
  const { set: one, modifier } = set.add({ label: 'ok', value: 1 });
  assert.throws(() => one.update(modifier.id, { value: Number.POSITIVE_INFINITY }), /finite/);
});

test('stored modifiers cannot be altered through the set', () => {
  const { modifier } = new ModifierSet().add({ label: 'a', value: 1, appliesTo: ['attack'] });
  assert.throws(() => (modifier.appliesTo as string[]).push('defense'), TypeError);
});

test('a set serializes to its modifiers and next id, so logs and snapshots keep them', () => {
  const { set } = new ModifierSet().add({ label: 'Shock', value: -2, appliesTo: ['attack'] });
  const json = JSON.parse(JSON.stringify(set));
  assert.deepEqual(json, { items: [{ id: 'mod-1', label: 'Shock', value: -2, appliesTo: ['attack'] }], nextId: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(new ModifierSet())), { items: [], nextId: 1 });
});
