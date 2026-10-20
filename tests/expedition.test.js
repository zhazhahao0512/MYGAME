import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/battle.js';
import * as M from '../src/model.js';

// Formal-roster journey checks: use real combat and transactions, without boosted stats
// or fabricated victories. These sample runs are not a final balance requirement.
for (const seed of [1, 7, 42]) {
  test(`formal-roster expedition reaches floor 20 through combat, shopping and saved checkpoints (seed ${seed})`, () => {
    let run = M.createRun(seed);
    M.recruit(run, run.candidates[0]);

    function equipEmptySlot(source, index) {
      const item = M.getOffer(run, source, index);
      if (source === 'shop' && run.gold < item.price) return false;
      for (const [heroIndex, member] of run.party.entries()) {
        if (item.rarity === 'orange' && member.gear.some(i => i?.rarity === 'orange')) continue;
        const slot = member.gear.indexOf(null);
        if (slot < 0) continue;
        M.acquire(run, source, index, heroIndex, slot);
        return true;
      }
      return false;
    }

    for (let floor = 1; floor <= 20; floor++) {
      assert.equal(run.floor, floor);
      if (floor <= 4) {
        assert.equal(run.phase, 'recruit');
        M.recruit(run, run.candidates[0]);
      }
      assert.equal(run.phase, 'ready');
      assert.equal(run.party.length, Math.min(5, floor + 1));

      run.party.forEach((_,i)=>M.recommendSkills(run,i));
      run.phase = 'battle';
      const battle = new Battle(run);
      for (let tick = 0; tick < 15000 && ['combat', 'cleanup'].includes(battle.phase); tick++) battle.step();
      assert.equal(battle.phase, 'won', `floor ${floor} must finish with the sampled loadout`);
      M.finishRound(run, battle.result());
      assert.equal(run.phase, 'shop');
      assert.throws(() => M.nextFloor(run), /宝箱/);

      if (!equipEmptySlot('chest', 0)) M.sellReward(run, 0);
      for (let index = 0; index < 4; index++) equipEmptySlot('shop', index);
      assert.ok(run.gold >= 0);
      assert.ok(run.party.every(member => M.validateLoadout(member.gear)));

      const restored = M.parseSave(JSON.stringify(run));
      assert.deepEqual(restored, run, 'between-floor checkpoint preserves the full journey');
      run = restored;
      M.nextFloor(run);
    }

    assert.equal(run.phase, 'victory');
    assert.equal(run.lastRound.floor, 20);
    assert.equal(new Set(run.party.map(member => member.hero)).size, 5);
    assert.ok(run.kills > 0);
  });
}
