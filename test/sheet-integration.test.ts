import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDamage, combatStats, getPool, parseCharacter } from '@gurps-sheet/character';

// The package's `exports` doesn't expose its examples, so locate them from its package.json.
const packageDir = dirname(fileURLToPath(import.meta.resolve('@gurps-sheet/character/package.json')));
const loadExample = (name: string) => parseCharacter(readFileSync(join(packageDir, 'examples', name), 'utf8'));

test('@gurps-sheet/character is linked and loads an example character', () => {
  const { character, report } = loadExample('rurik.json');
  const stats = combatStats(character);
  assert.ok(stats.name.length > 0);
  assert.ok(stats.hp.max > 0);
  assert.equal(report.rulesCompliant, true);
});

test('HP changes go through the library and leave the input untouched', () => {
  const { character } = loadExample('rurik.json');
  const before = getPool(character, 'hp').current;
  const hurt = applyDamage(character, 3);
  assert.equal(getPool(hurt, 'hp').current, before - 3);
  assert.equal(getPool(character, 'hp').current, before);
});
