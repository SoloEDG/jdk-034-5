import type { Contacts, Move, MoveRecord, Preview, Route } from '../../../shared/types';
import { evaluate } from '../../actions/lib/evaluate';
import { limbs } from '../../limbs/lib/support';

export interface ProofOptions {
  deadlineMs?: number;
  maxStates?: number;
  now?: () => number;
  start?: number;
}

export interface StateProof {
  key: string;
  contacts: Contacts;
  energy: number;
  canFinish: boolean;
  complete: boolean;
  states: number;
  transitions: number;
  legalMoves: number;
  safeMoves: number;
  finishMoves: number;
  truncated: boolean;
}

export interface DeadBranchProof {
  complete: boolean;
  canFinish: boolean;
  timedOut: boolean;
  statesVisited: number;
  transitionsChecked: number;
  legalMovesChecked: number;
  safeMovesChecked: number;
  rootLegalMoves: number;
  rootBlockedMoves: number;
  elapsedMs: number;
  limitMs: number;
  rootBranches: RootBranchCoverage[];
  witness?: MoveRecord[];
}

export interface RootBranchCoverage {
  limb: Move['limb'];
  target: string;
  cost: number;
  energyAfter: number;
  reach: number;
  distance: number;
  supportMargin: number;
  landingMargin: number;
  complete: boolean;
  canFinish: boolean;
  closed: boolean;
  failure?: Preview['failure'];
}

export function contactKey(contacts: Contacts, energy?: number): string {
  const base = limbs.map(limb => contacts[limb]).join('|');
  return energy === undefined ? base : `${base}#${energy}`;
}

export function enumeratePreviews(route: Route, contacts: Contacts, energy: number): Preview[] {
  const previews: Preview[] = [];
  for (const limb of limbs) {
    for (const hold of route.holds) {
      const preview = evaluate(route, contacts, { limb, target: hold.id }, energy);
      if (preview) previews.push(preview);
    }
  }
  return previews;
}

export function safePreviews(route: Route, contacts: Contacts, energy: number): Preview[] {
  return enumeratePreviews(route, contacts, energy).filter(item => item.failure === null);
}

function toRecord(preview: Preview, before: Contacts, energyBefore: number): MoveRecord {
  return {
    ...preview,
    before: { ...before },
    energyBefore,
    energyAfter: Math.max(0, energyBefore - preview.cost),
  };
}

/**
 * Exhaustively executes every safe limb/hold transition. Energy is part of the
 * state because fatigue changes reach and every move has a positive cost.
 */
export function proveCannotFinish(
  route: Route,
  rootContacts: Contacts,
  rootEnergy: number,
  options: ProofOptions = {},
): DeadBranchProof {
  const limitMs = options.deadlineMs ?? 1200;
  const maxStates = options.maxStates ?? 50_000;
  const now = options.now ?? (() => Date.now());
  const startedAt = options.start ?? now();
  const memo = new Map<string, StateProof>();
  const childWitness = new Map<string, MoveRecord[]>();
  const witness: MoveRecord[] = [];
  let timedOut = false;
  let globalStates = 0;

  function explore(contacts: Contacts, energy: number, trail: MoveRecord[]): StateProof {
    const key = contactKey(contacts, energy);
    const cached = memo.get(key);
    if (cached) return cached;

    globalStates += 1;
    const proof: StateProof = {
      key, contacts: { ...contacts }, energy,
      canFinish: false, complete: true, states: 1,
      transitions: 0, legalMoves: 0, safeMoves: 0, finishMoves: 0, truncated: false,
    };
    memo.set(key, proof);

    if (globalStates > maxStates || (globalStates & 127) === 0 && now() - startedAt > limitMs) {
      proof.complete = false;
      proof.truncated = true;
      timedOut = true;
      return proof;
    }

    const previews = enumeratePreviews(route, contacts, energy);
    proof.transitions = previews.length;
    proof.legalMoves = previews.length;

    for (const preview of previews) {
      if (preview.failure !== null) continue;
      proof.safeMoves += 1;
      const before = { ...contacts };
      const record = toRecord(preview, before, energy);
      const nextEnergy = energy - preview.cost;

      if (preview.move.target === route.finish) {
        proof.finishMoves += 1;
        proof.canFinish = true;
        const fullWitness = [...trail, record];
        childWitness.set(proof.key, fullWitness);
        witness.length = 0;
        witness.push(...fullWitness);
        return proof;
      }

      const child = explore(preview.next, nextEnergy, [...trail, record]);
      proof.states += child.states;
      if (!child.complete) proof.complete = false;
      if (child.canFinish) {
        proof.canFinish = true;
        const path = childWitness.get(child.key) ?? [];
        childWitness.set(proof.key, path);
        if (witness.length === 0) witness.push(...path);
        return proof;
      }
      if (!child.complete) {
        timedOut = true;
        return proof;
      }
    }

    return proof;
  }

  const root = explore(rootContacts, rootEnergy, []);
  const rootPreviews = enumeratePreviews(route, rootContacts, rootEnergy);
  const rootBranches: RootBranchCoverage[] = rootPreviews.map(preview => {
    const childEnergy = Math.max(0, rootEnergy - preview.cost);
    if (preview.failure) {
      return {
        limb: preview.move.limb,
        target: preview.move.target,
        cost: preview.cost,
        energyAfter: childEnergy,
        reach: preview.reach,
        distance: preview.distance,
        supportMargin: preview.support.margin,
        landingMargin: preview.landing.margin,
        complete: true,
        canFinish: false,
        closed: true,
        failure: preview.failure,
      };
    }
    const child = memo.get(contactKey(preview.next, rootEnergy - preview.cost));
    // A timeout can leave the child absent only when exploration stopped early.
    const complete = child?.complete ?? false;
    const canFinish = child?.canFinish ?? false;
    return {
      limb: preview.move.limb,
      target: preview.move.target,
      cost: preview.cost,
      energyAfter: childEnergy,
      reach: preview.reach,
      distance: preview.distance,
      supportMargin: preview.support.margin,
      landingMargin: preview.landing.margin,
      complete,
      canFinish,
      closed: complete && !canFinish,
      failure: null,
    };
  });

  const safeRootCount = rootBranches.filter(branch => branch.failure === null).length;
  const blockedRootCount = rootBranches.length - safeRootCount;
  const allRootBranchesClosed = rootBranches.every(branch => branch.closed);
  const elapsedMs = Math.max(0, now() - startedAt);
  const withinLimit = elapsedMs <= limitMs;
  return {
    complete: root.complete && !timedOut && withinLimit && allRootBranchesClosed,
    canFinish: root.canFinish,
    timedOut,
    statesVisited: memo.size,
    transitionsChecked: [...memo.values()].reduce((sum, item) => sum + item.transitions, 0),
    legalMovesChecked: [...memo.values()].reduce((sum, item) => sum + item.legalMoves, 0),
    safeMovesChecked: [...memo.values()].reduce((sum, item) => sum + item.safeMoves, 0),
    rootLegalMoves: safeRootCount,
    rootBlockedMoves: blockedRootCount,
    elapsedMs,
    limitMs,
    rootBranches,
    witness: root.canFinish ? witness : undefined,
  };
}

export interface VerifiedPath {
  ok: boolean;
  reason?: string;
  records: MoveRecord[];
  totalCost: number;
  remaining: number;
  finalContacts: Contacts;
  finished: boolean;
}

export function verifyPath(
  route: Route,
  initial: Contacts,
  moves: Move[],
  energyCap: number,
): VerifiedPath {
  let contacts = { ...initial };
  let energy = energyCap;
  const records: MoveRecord[] = [];

  for (const move of moves) {
    const preview = evaluate(route, contacts, move, energy);
    if (!preview) {
      return { ok: false, reason: `动作 ${move.limb}→${move.target} 与岩点类型或占用状态冲突`, records, totalCost: energyCap - energy, remaining: energy, finalContacts: contacts, finished: false };
    }
    if (preview.failure) {
      return { ok: false, reason: `动作 ${move.limb}→${move.target} 未通过：${preview.failure}`, records, totalCost: energyCap - energy, remaining: energy, finalContacts: contacts, finished: false };
    }
    const record = toRecord(preview, contacts, energy);
    records.push(record);
    contacts = { ...preview.next };
    energy = record.energyAfter;
  }

  const finished = Object.values(contacts).includes(route.finish);
  return {
    ok: true,
    records,
    totalCost: energyCap - energy,
    remaining: energy,
    finalContacts: contacts,
    finished,
  };
}

/** Budget-aware DFS used by the generator to discover evidence paths. */
export function findPath(
  route: Route,
  initial: Contacts,
  energyCap: number,
  options: ProofOptions & { requiredHolds?: string[]; forbiddenHolds?: string[]; maxMoves?: number } = {},
): { found: boolean; complete: boolean; path: MoveRecord[]; visited: number; elapsedMs: number } {
  const limitMs = options.deadlineMs ?? 1200;
  const maxStates = options.maxStates ?? 50_000;
  const now = options.now ?? (() => Date.now());
  const startedAt = options.start ?? now();
  const required = new Set(options.requiredHolds ?? []);
  const forbidden = new Set(options.forbiddenHolds ?? []);
  const maxMoves = options.maxMoves ?? 40;
  const visitedKeys = new Set<string>();
  let visited = 0;
  let complete = true;

  function dfs(contacts: Contacts, energy: number, trail: MoveRecord[], usedRequired: Set<string>): MoveRecord[] | null {
    if (now() - startedAt > limitMs || visited > maxStates) {
      complete = false;
      return null;
    }
    if (trail.length > maxMoves) return null;
    const key = `${contactKey(contacts, energy)}|${[...usedRequired].sort().join(',')}`;
    if (visitedKeys.has(key)) return null;
    visitedKeys.add(key);
    visited += 1;

    if (Object.values(contacts).includes(route.finish) && required.size === usedRequired.size) return trail;

    const previews = safePreviews(route, contacts, energy)
      .filter(preview => !forbidden.has(preview.move.target))
      .sort((a, b) => {
        const ah = route.holds.find(h => h.id === a.move.target)!;
        const bh = route.holds.find(h => h.id === b.move.target)!;
        return ah.y - bh.y;
      });

    for (const preview of previews) {
      const nextRequired = new Set(usedRequired);
      if (required.has(preview.move.target)) nextRequired.add(preview.move.target);
      const record = toRecord(preview, contacts, energy);
      const result = dfs(preview.next, energy - preview.cost, [...trail, record], nextRequired);
      if (result) return result;
      if (!complete) return null;
    }
    return null;
  }

  const path = dfs(initial, energyCap, [], new Set());
  return { found: Boolean(path), complete, path: path ?? [], visited, elapsedMs: now() - startedAt };
}
