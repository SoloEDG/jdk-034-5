import type { Contacts, Move, Preview, Route } from '../../../shared/types';
import { holdAt } from '../../wall/lib/holds';
import { balance } from '../../limbs/lib/support';
import { isHand, measureReach } from '../../limbs/lib/reach';
import { moveCost } from '../../stamina/lib/cost';

export function evaluate(route: Route, contacts: Contacts, move: Move, energy: number): Preview | null {
  const target = holdAt(route, move.target);
  if (Object.values(contacts).includes(target.id) || isHand(move.limb) === (target.kind === 'step')) return null;
  const next = { ...contacts, [move.limb]: target.id };
  const scale = route.costScale ?? 1;
  // Blueprints are proved at a reference budget. Scaling the displayed stamina
  // also scales costs; using a virtual fatigue energy preserves reach geometry.
  const fatigueEnergy = scale === 1 ? energy : energy / scale;
  const measure = measureReach(route, contacts, move.limb, target.id, fatigueEnergy);
  const support = balance(route, contacts, move.limb);
  const landing = balance(route, next);
  const baseCost = moveCost(measure.travel, target.kind, route.tilt, support.margin);
  const rawCost = baseCost * scale;
  const cost = scale === 1 ? baseCost : Math.max(0.1, Math.round(rawCost * 100) / 100);
  const failure = measure.distance > measure.reach ? 'reach'
    : support.margin < 0 || landing.margin < 0 ? 'support'
    : energy < cost ? 'energy' : null;
  return { move, next, cost, distance: measure.distance, reach: measure.reach, support, landing, failure };
}

export const failures = {
  reach: '超出可触及范围',
  support: '身体支撑不足，发生失衡',
  energy: '剩余体力不足',
};
