import type { Attempt, Route } from '../../../shared/types';

export type VerdictKind = 'A' | 'B' | 'AB' | 'other-success' | 'lured' | 'recovered-A' | 'recovered-B' | 'recovered-mixed' | 'fall' | 'unknown';

export interface AttemptVerdict {
  kind: VerdictKind;
  label: string;
  usedA: string[];
  usedB: string[];
  enteredLure: boolean;
  reachedLurePosture: boolean;
}

function successfulTargets(attempt: Attempt) {
  return attempt.moves.filter(record => !record.failure).map(record => record.move.target);
}

function usedGroup(targets: string[], group: string[]) {
  return group.filter(id => targets.includes(id));
}

function contactsMatchPosture(attempt: Attempt, posture: Record<string, string>) {
  // Check every stable prefix after each successful action. The final failed
  // move stores its unlanded `next`, so it must not be treated as a contact.
  let contacts: Record<string, string> | null = null;
  for (const record of attempt.moves) {
    if (record.failure) continue;
    contacts = record.next as Record<string, string>;
    if (Object.entries(posture).every(([limb, id]) => contacts?.[limb] === id)) return true;
  }
  return false;
}

export function classifyAttempt(route: Route, attempt: Attempt): AttemptVerdict {
  const hints = route.certificate?.classificationHints;
  const targets = successfulTargets(attempt);
  const usedA = usedGroup(targets, hints?.aMiddle ?? []);
  const usedB = usedGroup(targets, hints?.bMiddle ?? []);
  const lureHoldSet = new Set(hints?.lureHolds ?? []);
  const enteredLure = targets.some(id => lureHoldSet.has(id) && (id === '21' || id === '22'));
  const reachedLurePosture = hints ? contactsMatchPosture(attempt, hints.lurePosture) : false;
  const a = usedA.length >= 2;
  const b = usedB.length >= 2;

  if (attempt.result === 'success') {
    if (a && b) return { kind: 'AB', label: enteredLure ? '混合方案（曾入诱导）' : 'A+B 混合方案', usedA, usedB, enteredLure, reachedLurePosture };
    if (a && enteredLure) return { kind: 'recovered-A', label: '误入诱导后转回 A', usedA, usedB, enteredLure, reachedLurePosture };
    if (b && enteredLure) return { kind: 'recovered-B', label: '误入诱导后转回 B', usedA, usedB, enteredLure, reachedLurePosture };
    if (a) return { kind: 'A', label: 'A 中段方案', usedA, usedB, enteredLure, reachedLurePosture };
    if (b) return { kind: 'B', label: 'B 中段方案', usedA, usedB, enteredLure, reachedLurePosture };
    return { kind: 'other-success', label: '其他合法完攀线', usedA, usedB, enteredLure, reachedLurePosture };
  }

  if (reachedLurePosture) return { kind: 'lured', label: '诱导成功 · 困在近路', usedA, usedB, enteredLure, reachedLurePosture };
  if (enteredLure) return { kind: 'fall', label: '接触诱导点后坠落', usedA, usedB, enteredLure, reachedLurePosture };
  return { kind: 'fall', label: '其他坠落', usedA, usedB, enteredLure, reachedLurePosture };
}
