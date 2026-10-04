import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listNpcs } from '@gurps-sheet/npcs';
import {
  bestExpectedInjury,
  CombatError,
  createCombat,
  createDiceManager,
  isWoundingType,
  npcCombatant,
  npcGroup,
  parseNotation,
  runToCompletion,
  seededSource,
  type TurnAction,
} from '../src/index.js';
import { FIXED_TIME, hp, newCombat, play, scripted } from './fixtures.js';

const attackSummary = (id: string) =>
  npcCombatant(id, { side: 'x' }).combatant.attacks.map((a) => `${a.name}@${a.skill} ${a.damage.notation} ${a.damage.type}`);

test('weapons are matched to skills through the Basic Set catalog: knives, staffs and cutlasses', () => {
  // The mercenary knight carries a broadsword, a lance and a dagger (a Knife-skill weapon). The lance is
  // for fighting from horseback (p.204), which isn't modelled, so it is left out with a warning.
  const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' });
  assert.deepEqual(knight.warnings, ['Weapon "Lance" uses Lance, which is for mounted combat (p.204), not modelled yet']);
  assert.deepEqual(
    knight.combatant.attacks.map((a) => a.name),
    ['Broadsword (swing)', 'Broadsword (thrust)', 'Dagger', 'Punch'],
  );
  // A cutlass uses Shortsword; the pirate captain used to be left with only his fists.
  assert.ok(attackSummary('swashbuckling-pirate-captain').some((a) => a.startsWith('Cutlass ')));
  // A quarterstaff uses Staff.
  assert.ok(attackSummary('fantasy-court-wizard').some((a) => a.startsWith('Quarterstaff ')));
});

test('every NPC either has an attack or says why not: nothing is silently useless', () => {
  const summaries = listNpcs();
  assert.ok(summaries.length >= 30);
  for (const summary of summaries) {
    const { combatant, warnings } = npcCombatant(summary.id, { side: 'x' });
    assert.ok(combatant.attacks.length > 0 || warnings.some((w) => /no melee attack/.test(w)), summary.id);
    for (const attack of combatant.attacks) {
      assert.doesNotThrow(() => parseNotation(attack.damage.notation), `${summary.id} ${attack.id}`);
      assert.ok(isWoundingType(attack.damage.type), `${summary.id} ${attack.id}`);
      assert.ok(Number.isFinite(attack.skill), `${summary.id} ${attack.id}`);
    }
  }
});

test('an NPC with only ranged weapons says that is why it can\'t fight yet', () => {
  const spy = npcCombatant('modern-spy', { side: 'x' });
  assert.deepEqual(spy.combatant.attacks, []);
  assert.match(spy.warnings.join(), /1 ranged weapon, which aren't modelled yet/);
  // Someone with a melee attack gets no such warning, even if they also carry a gun.
  assert.deepEqual(npcCombatant('western-gunslinger', { side: 'x' }).warnings, []);
});

test('text-only weapon damage (the wooden stake) is reported without hiding the monster hunter\'s other weapon', () => {
  const hunter = npcCombatant('horror-monster-hunter', { side: 'x' });
  assert.deepEqual(hunter.combatant.attacks.map((a) => a.name), ['Hatchet']);
  assert.match(hunter.warnings.join(), /"Wooden Stake" mode 1 has damage the sheet gives only as text \(thr\(0\.5\) imp\)/);
});

test('DR only on other body parts is not a problem: torso DR is simply 0', () => {
  const marshal = npcCombatant('western-marshal', { side: 'x' });
  assert.equal(marshal.combatant.dr, 0);
  assert.ok(!marshal.warnings.some((w) => /DR/.test(w)));
});

test('an NPC fights with the stats on its sheet', () => {
  const guard = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant;
  assert.equal(guard.id, 'fantasy-town-guard');
  assert.equal(guard.dr, 2);
  assert.equal(guard.dodge, 8);
  assert.equal(guard.attacks[0]?.name, 'Spear');
  assert.equal(guard.attacks[0]?.damage.type, 'imp');
});

test('id and name can be overridden, and an unknown NPC is refused with the list of known ones', () => {
  const renamed = npcCombatant('fantasy-town-guard', { side: 'b', id: 'gate-guard', name: 'Gate Guard' }).combatant;
  assert.deepEqual([renamed.id, renamed.name], ['gate-guard', 'Gate Guard']);
  assert.throws(() => npcCombatant('fantasy-dragon', { side: 'b' }), /Unknown NPC "fantasy-dragon".*fantasy-town-guard/);
});

test('a group is numbered, and its members are independent: hurting one leaves the others whole', () => {
  const group = npcGroup({ npc: 'fantasy-town-guard', side: 'b', count: 3 });
  assert.deepEqual(group.map((g) => g.combatant.id), ['fantasy-town-guard-1', 'fantasy-town-guard-2', 'fantasy-town-guard-3']);
  const base = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant.name;
  assert.deepEqual(group.map((g) => g.combatant.name), [`${base} 1`, `${base} 2`, `${base} 3`]);

  const [lone] = npcGroup({ npc: 'fantasy-town-guard', side: 'b' });
  assert.equal(lone?.combatant.id, 'fantasy-town-guard', 'a single NPC keeps its plain id');
  assert.throws(() => npcGroup({ npc: 'fantasy-town-guard', side: 'b', count: 0 }), RangeError);

  // The knight (Speed 6.25) acts first and swings at guard 1. Faces: the guards' tie roll-off (5, 2), then
  // attack 3+3+3=9 vs 16 (hit), Dodge 6+6+6=18 vs 8 (fails), damage 4+4=8 less DR 2, x1.5 cut = 9. That is
  // more than half of 11 HP, a major wound, so the guard rolls HT 12: 3+3+4 = 10 keeps him on his feet.
  const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
  const [one, two] = npcGroup({ npc: 'fantasy-town-guard', side: 'b', count: 2 }).map((g) => g.combatant);
  const combat = newCombat(scripted(5, 2, 3, 3, 3, 6, 6, 6, 4, 4, 3, 3, 4), [knight, one!, two!]);
  const max = hp(combat, 'fantasy-town-guard-1');
  assert.equal(max, hp(combat, 'fantasy-town-guard-2'));

  const result = play(combat, { maneuver: 'attack', attackId: knight.attacks[0]!.id, targetId: 'fantasy-town-guard-1' });
  assert.equal(result.attack?.damage?.injury.injury, 9);
  assert.equal(result.attack?.targetEffects?.majorWound, true);
  assert.equal(result.attack?.targetEffects?.knockdown, 'none');
  assert.equal(result.attack?.targetEffects?.shock, 4, '9 HP of shock, capped at 4');
  assert.equal(hp(combat, 'fantasy-town-guard-1'), max - 9);
  assert.equal(hp(combat, 'fantasy-town-guard-2'), max, 'the other guard is untouched');
});

test('NPCs fight: a knight against a squad of guards runs to a finish, reproducibly', () => {
  const play = (seed: number) => {
    const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
    const guards = npcGroup({ npc: 'fantasy-town-guard', side: 'b', count: 3 }).map((g) => g.combatant);
    const combat = createCombat([knight, ...guards], { dice: createDiceManager({ source: seededSource(seed) }), clock: () => FIXED_TIME });
    const { finished, results } = runToCompletion(combat, bestExpectedInjury);
    return { finished, results, view: combat.view() };
  };
  const first = play(11);
  assert.equal(first.finished, true);
  assert.deepEqual(play(11), first);
});

test('every NPC that can attack can fight another one without breaking the engine', () => {
  const fighters = listNpcs().filter((s) => npcCombatant(s.id, { side: 'x' }).combatant.attacks.length > 0);
  assert.ok(fighters.length >= 15);
  for (const [index, summary] of fighters.entries()) {
    const other = fighters[(index + 1) % fighters.length]!;
    if (other.id === summary.id) continue;
    const a = npcCombatant(summary.id, { side: 'a' }).combatant;
    const b = npcCombatant(other.id, { side: 'b' }).combatant;
    const combat = createCombat([a, b], { dice: createDiceManager({ source: seededSource(index + 1) }), clock: () => FIXED_TIME });
    // The DR 40 space marine can be unbeatable for a mook, so allow a stalemate; what matters is that nothing throws.
    const { results } = runToCompletion(combat, bestExpectedInjury, { maxTurns: 200 });
    assert.ok(results.length > 0, `${summary.id} vs ${other.id}`);
  }
});

test('sheetOf shows a fighter\'s current sheet, HP included, as a copy', () => {
  const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
  const guard = npcCombatant('fantasy-town-guard', { side: 'b' }).combatant;
  // Knight is faster: Speed 6.25 vs 5.75. His broadsword swing: hit (9 vs 16), the guard's Dodge 8 fails (18),
  // damage 3+3 = 6 (DR 2, x1.5: 6 HP, a major wound on 11 HP), and the guard's HT roll 3+3+4 = 10 succeeds.
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 3, 3, 3, 4), [knight, guard]);
  const before = combat.sheetOf(guard.id);
  const max = hp(combat, guard.id);

  const action: TurnAction = { maneuver: 'attack', attackId: knight.attacks[0]!.id, targetId: guard.id };
  const result = play(combat, action);
  const hurt = result.attack?.damage?.injury.injury ?? 0;
  assert.ok(hurt > 0);

  const after = combat.sheetOf(guard.id);
  assert.equal(after.profile.name, before.profile.name);
  assert.equal(hp(combat, guard.id), max - hurt);
  assert.notDeepEqual(after, before, 'the sheet reflects the wound');

  // Changing the copy does not change the fight.
  after.profile.name = 'Tampered';
  assert.equal(combat.sheetOf(guard.id).profile.name, before.profile.name);
  assert.throws(() => combat.sheetOf('nobody'), CombatError);
  assert.throws(() => combat.sheetOf('toString'), CombatError);
});
