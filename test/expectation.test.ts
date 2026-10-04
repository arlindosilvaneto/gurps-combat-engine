import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diceDistribution, expectedInjury, successChance } from '../src/index.js';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);

test('diceDistribution is exact: one die is uniform, 3d has the familiar 27/216 at 10', () => {
  for (const [, p] of diceDistribution(1, 6)) close(p, 1 / 6);
  const threeD = new Map(diceDistribution(3, 6));
  close(threeD.get(10)!, 27 / 216);
  close(threeD.get(3)!, 1 / 216);
  close(threeD.get(18)!, 1 / 216);
  close([...threeD.values()].reduce((a, b) => a + b, 0), 1);
});

test('successChance counts the always-succeed 3-4 and the never-succeed 17-18', () => {
  close(successChance(9), 81 / 216); // 3..9: 1+3+6+10+15+21+25
  close(successChance(3), 4 / 216); // a 3, plus the 4 that always succeeds
  close(successChance(-5), 4 / 216, );
  close(successChance(30), 212 / 216); // everything but 17 and 18
});

test('expectedInjury without a dodge: chance to hit times the average injury after DR', () => {
  // 1d+1 cutting vs DR 3: totals 2..7 -> injury 0,0,1,3,4,6 (average 14/6).
  close(expectedInjury({ skill: 30, damage: { notation: '1d+1', type: 'cut' }, targetDr: 3, dodge: null }), (212 / 216) * (14 / 6));
});

test('expectedInjury with a dodge: only critical hits, and the hits the dodge misses, land', () => {
  // Skill 30: totals 3-6 are critical hits (20 of 216 ways), 7-16 plain hits (192 ways).
  const dodged = 212 / 216;
  const landed = 20 / 216 + (192 / 216) * (1 - dodged);
  close(expectedInjury({ skill: 30, damage: { notation: '1d+1', type: 'cut' }, targetDr: 3, dodge: 30 }), landed * (14 / 6));
});

test('armor that stops everything means no expected injury, and a better dodge means less', () => {
  assert.equal(expectedInjury({ skill: 15, damage: { notation: '1d', type: 'cr' }, targetDr: 10, dodge: null }), 0);
  const base = { skill: 14, damage: { notation: '2d', type: 'cut' as const }, targetDr: 0 };
  assert.ok(expectedInjury({ ...base, dodge: 6 }) > expectedInjury({ ...base, dodge: 12 }));
  assert.ok(expectedInjury({ ...base, dodge: null }) > expectedInjury({ ...base, dodge: 6 }));
});

test('damage floors apply: a 1d-3 crushing hit can do nothing, a 1d-3 cutting hit at least 1 basic', () => {
  // cr floor 0 -> injury 0 whenever the roll is <= 3; cut floor 1 -> always at least 1 basic damage.
  const cr = expectedInjury({ skill: 30, damage: { notation: '1d-3', type: 'cr' }, targetDr: 0, dodge: null });
  const cut = expectedInjury({ skill: 30, damage: { notation: '1d-3', type: 'cut' }, targetDr: 0, dodge: null });
  close(cr, (212 / 216) * ((0 + 0 + 0 + 1 + 2 + 3) / 6));
  // cut: basics 1,1,1,1,2,3 -> x1.5 rounded down: 1,1,1,1,3,4 = 11/6
  close(cut, (212 / 216) * (11 / 6));
});
