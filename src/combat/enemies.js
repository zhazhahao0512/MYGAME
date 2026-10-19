// Playtest curve calibrated against the R048 hero panels. Fixed by floor, never
// by the player's level, equipment or damage: a stronger build stays stronger.
export function enemyStats(base,{floor,slot,type,boss=false}) {
  const f=Math.max(1,Math.floor(floor));
  // Recruitment ramps from two to five heroes over the first four floors.
  const opening=.65+.35*Math.min(1,(f-1)/3);
  const health=(440+120*f+1.5*f*f)*opening;
  const attack=6+1.5*f+1.5*Math.max(0,f-4);
  const resistance=10+1.5*f;
  return {...base,
    hp:Math.round(health*(boss?3.2:type.health)),
    attack:boss?attack*1.4:attack*type.damage,
    power:0,attackSpeed:boss?.65:.55+(slot%3)*.1,
    armor:resistance,resist:resistance,hpRegen:0,
    mana:30,manaRegen:1,crit:0,move:type.move,
  };
}
