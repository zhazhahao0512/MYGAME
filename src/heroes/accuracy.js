// D003 / ACCURACY-DESIGN: points, one roll, no extra floor or attribute cap.
export function actionHitChance(source,target,{accuracy=0,distancePenalty}={}){
  const perSlot=distancePenalty??(source.def?.range==='melee'?5:2);
  const distance=Math.max(0,(source.slot||0)+(target.slot||0));
  return Math.max(0,Math.min(1,((source.stats.accuracy??95)+accuracy-(target.stats.evasion??0)-distance*perSlot)/100));
}
// Legacy bonuses only, never turn the old base movement 100 into evasion 100.
export function migrateAccuracyBonuses(stats){
  const result={...stats};
  if(Object.hasOwn(result,'focus')){result.accuracy=(result.accuracy||0)+result.focus;delete result.focus;}
  if(Object.hasOwn(result,'move')){result.evasion=(result.evasion||0)+result.move;delete result.move;}
  return result;
}
