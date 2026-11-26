import type {
  GeneratorInput, Hold, HoldKind, MaterialQuota, Move, Route, RouteCertificate, RouteLineEvidence,
} from '../../../shared/types';
import { routes } from '../../wall/lib/routes';
import { body } from '../../limbs/lib/support';
import { distance } from '../../../shared/geometry';
import { proveCannotFinish, verifyPath, type DeadBranchProof } from './solver';

export const REFERENCE_BUDGET = 50;
export const BLUEPRINT_VERSION = 'fork-v1';

export const CORE_IDS = [
  '01', '02', '03', '04', '06', '08', '09', '10', '11', '12',
  '14', '16', '17', '18', '19', '20', '21', '22',
] as const;

export const BASELINE_QUOTA: MaterialQuota = { jug: 6, edge: 2, slope: 3, step: 7 };

export const LINE_A: Move[] = [
  { limb: 'lh', target: '10' },
  { limb: 'lf', target: '06' },
  { limb: 'lh', target: '12' },
  { limb: 'rf', target: '17' },
  { limb: 'lf', target: '19' },
  { limb: 'rh', target: '11' },
  { limb: 'lh', target: '16' },
];

export const LINE_B: Move[] = [
  { limb: 'rh', target: '09' },
  { limb: 'rf', target: '18' },
  { limb: 'lh', target: '08' },
  { limb: 'lf', target: '17' },
  { limb: 'lf', target: '19' },
  { limb: 'rf', target: '20' },
  { limb: 'rh', target: '14' },
  { limb: 'lh', target: '16' },
];

export const LURE_PREFIX: Move[] = [
  { limb: 'rh', target: '08' },
  { limb: 'lf', target: '17' },
  { limb: 'lh', target: '21' },
  { limb: 'rh', target: '22' },
];

export const A_MIDDLE = ['10', '06', '12', '11'];
export const B_MIDDLE = ['09', '18', '08', '20', '14'];
export const LURE_HOLDS = ['08', '17', '21', '22'];
export const LURE_POSTURE = { lh: '21', rh: '22', lf: '17', rf: '02' } as const;

const REF_FINISH = { x: 372, y: 59 };
const REF_START = { x: 327.5, y: 496 };

export interface GenerationResult {
  ok: boolean;
  publishable: boolean;
  route: Route | null;
  errors: string[];
  attempts: number;
  elapsedMs: number;
}

function hashInput(input: GeneratorInput): string {
  const raw = JSON.stringify({ ...input, proofLimitMs: undefined });
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quotaOf(holds: Hold[]): MaterialQuota {
  return holds.reduce<MaterialQuota>((sum, hold) => {
    sum[hold.kind] += 1;
    return sum;
  }, { jug: 0, edge: 0, slope: 0, step: 0 });
}

function transformPoint(x: number, y: number, input: GeneratorInput) {
  const t = (y - REF_FINISH.y) / (REF_START.y - REF_FINISH.y);
  const refX = REF_FINISH.x + (REF_START.x - REF_FINISH.x) * t;
  return {
    x: Math.round((input.finish.x + (input.start.x - input.finish.x) * t + x - refX) * 10) / 10,
    y: Math.round((input.finish.y + (input.start.y - input.finish.y) * t) * 10) / 10,
  };
}

function makeFiller(id: string, kind: HoldKind, random: () => number, existing: Hold[], input: GeneratorInput): Hold | null {
  for (let tries = 0; tries < 90; tries += 1) {
    const isStep = kind === 'step';
    const x = 72 + random() * 576;
    const y = isStep ? 392 + random() * 126 : 255 + random() * 215;
    if (existing.some(hold => Math.hypot(hold.x - x, hold.y - y) < 42)) continue;
    const point = transformPoint(x, y, input);
    if (point.x < 34 || point.x > 686 || point.y < 35 || point.y > 532) continue;
    return {
      id,
      x: point.x,
      y: point.y,
      kind,
      angle: Math.round(-34 + random() * 68),
    };
  }
  return null;
}

function buildCandidate(input: GeneratorInput, candidateSeed: number): { route: Route; errors: string[] } {
  const errors: string[] = [];
  const quota = input.quota;
  (Object.keys(BASELINE_QUOTA) as HoldKind[]).forEach(kind => {
    if (quota[kind] < BASELINE_QUOTA[kind]) {
      errors.push(`${kindLabel(kind)}配额至少需要 ${BASELINE_QUOTA[kind]}（结构/证明锚点），当前为 ${quota[kind]}`);
    }
  });
  if ((Object.values(quota) as number[]).reduce<number>((a, b) => a + b, 0) !== input.holdCount) {
    errors.push('四类配额之和必须等于岩点总数');
  }
  if (input.holdCount < CORE_IDS.length) {
    errors.push(`可证明的误导蓝图至少需要 ${CORE_IDS.length} 个岩点`);
  }
  if (errors.length) {
    const empty: Route = { ...routes[0], id: 'invalid', energy: input.energy, holds: [] };
    return { route: empty, errors };
  }

  const random = rng(candidateSeed);
  const extra: MaterialQuota = {
    jug: quota.jug - BASELINE_QUOTA.jug,
    edge: quota.edge - BASELINE_QUOTA.edge,
    slope: quota.slope - BASELINE_QUOTA.slope,
    step: quota.step - BASELINE_QUOTA.step,
  };

  const core: Hold[] = routes[0].holds
    .filter(hold => CORE_IDS.includes(hold.id as typeof CORE_IDS[number]))
    .map(hold => {
      let next: Hold = { ...hold };
      if (hold.id === '14') next.kind = 'jug';
      if (hold.id === '20') next.y = 210;
      const point = transformPoint(next.x, next.y, input);
      return { ...next, ...point };
    });

  const lureTemplates: Hold[] = [
    { id: '21', x: 398, y: 214, kind: 'slope', angle: -8 },
    { id: '22', x: 438, y: 158, kind: 'slope', angle: 18 },
  ];
  const extraHolds: Hold[] = lureTemplates.map(hold => ({ ...hold, ...transformPoint(hold.x, hold.y, input) }));

  const holds = [...core, ...extraHolds];
  let fillerIndex = 1;
  (Object.keys(extra) as HoldKind[]).forEach(kind => {
    for (let i = 0; i < extra[kind]; i += 1) {
      const filler = makeFiller(`X${String(fillerIndex).padStart(2, '0')}`, kind, random, holds, input);
      fillerIndex += 1;
      if (!filler) {
        errors.push('无法在不重叠且不越界的情况下放置额外岩点');
        return;
      }
      holds.push(filler);
    }
  });

  const route: Route = {
    ...routes[0],
    id: `gen-${hashInput(input)}-${candidateSeed}`,
    name: `误导蓝图 ${input.holdCount}`,
    grade: input.energy <= 45 ? 'V6' : input.energy >= 120 ? 'V2' : 'V4',
    color: '#c79bff',
    tilt: 0,
    energy: input.energy,
    costScale: input.energy / REFERENCE_BUDGET,
    start: { ...routes[0].start },
    finish: '16',
    holds,
    generator: { generated: true, seed: input.seed, blueprint: BLUEPRINT_VERSION, status: 'unverified' },
  };
  return { route, errors };
}

function makeLine(
  id: 'A' | 'B',
  name: string,
  middleHolds: string[],
  verified: ReturnType<typeof verifyPath>,
): RouteLineEvidence | null {
  if (!verified.ok || !verified.finished) return null;
  return {
    id,
    name,
    middleHolds,
    moves: verified.records,
    cost: verified.totalCost,
    remaining: verified.remaining,
  };
}

export function kindLabel(kind: HoldKind): string {
  return { jug: '把手点', edge: '薄边点', slope: '斜面点', step: '脚点' }[kind];
}

export function generateRoute(input: GeneratorInput): GenerationResult {
  const started = Date.now();
  const preliminary = buildCandidate(input, input.seed);
  if (preliminary.errors.length) {
    return { ok: false, publishable: false, route: null, errors: preliminary.errors, attempts: 0, elapsedMs: Date.now() - started };
  }

  const maxAttempts = 8;
  let lastErrors = preliminary.errors;
  let lastRoute: Route | null = null;
  let attemptsUsed = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attemptsUsed = attempt + 1;
    const candidateSeed = (input.seed + attempt * 100003) >>> 0;
    const built = attempt === 0 ? preliminary : buildCandidate(input, candidateSeed);
    if (built.errors.length) {
      lastErrors = built.errors;
      continue;
    }
    const route = built.route;
    lastRoute = route;

    const a = verifyPath(route, route.start, LINE_A, input.energy);
    const b = verifyPath(route, route.start, LINE_B, input.energy);
    const lure = verifyPath(route, route.start, LURE_PREFIX, input.energy);
    const lineA = makeLine('A', '左叉 · 10/12/11 中段组', A_MIDDLE, a);
    const lineB = makeLine('B', '右叉 · 09/08/14 中段组', B_MIDDLE, b);

    if (!lineA || !lineB || !lure.ok) {
      lastErrors = [
        !lineA ? `A 方案证据未通过：${a.reason ?? '未到达终点'}` : '',
        !lineB ? `B 方案证据未通过：${b.reason ?? '未到达终点'}` : '',
        !lure.ok ? `诱导前缀未站稳：${lure.reason ?? '动作不合法'}` : '',
      ].filter(Boolean);
      continue;
    }

    const proof: DeadBranchProof = proveCannotFinish(route, lure.finalContacts, lure.remaining, {
      deadlineMs: input.proofLimitMs,
      maxStates: 100_000,
    });

    const startCenter = body(route, route.start);
    const lureCenter = body(route, lure.finalContacts);
    const finish = route.holds.find(hold => hold.id === route.finish)!;
    const startDistance = Math.round(distance(startCenter, finish));
    const lureDistance = Math.round(distance(lureCenter, finish));
    const closer = lureDistance + 8 < startDistance;

    const notEarlyExhaustion = lure.remaining > 0;
    const publishable = proof.complete && !proof.canFinish && proof.rootLegalMoves > 0
      && closer && notEarlyExhaustion;
    const actualQuota = quotaOf(route.holds);
    const certificate: RouteCertificate = {
      schemaVersion: 1,
      qualified: publishable,
      generatedAt: Date.now(),
      input: { ...input, quota: { ...input.quota }, start: { ...input.start }, finish: { ...input.finish } },
      actualQuota,
      seed: candidateSeed,
      attempts: attempt + 1,
      elapsedMs: Date.now() - started,
      lines: [lineA, lineB],
      lure: {
        name: '中央近路 · 08→17→21→22',
        posture: { ...lure.finalContacts },
        moves: lure.records,
        cost: lure.totalCost,
        remaining: lure.remaining,
        closerDistance: lureDistance,
        splitDistance: startDistance,
        proof: {
          complete: proof.complete,
          canFinish: proof.canFinish,
          timedOut: proof.timedOut,
          statesVisited: proof.statesVisited,
          transitionsChecked: proof.transitionsChecked,
          safeMovesChecked: proof.safeMovesChecked,
          rootLegalMoves: proof.rootLegalMoves,
          rootBlockedMoves: proof.rootBlockedMoves,
          elapsedMs: proof.elapsedMs,
          limitMs: proof.limitMs,
          rootBranches: proof.rootBranches.map(branch => ({
            limb: branch.limb,
            target: branch.target,
            cost: branch.cost,
            energyAfter: branch.energyAfter,
            complete: branch.complete,
            canFinish: branch.canFinish,
            closed: branch.closed,
            failure: branch.failure ?? null,
          })),
        },
      },
      classificationHints: {
        aMiddle: [...A_MIDDLE],
        bMiddle: [...B_MIDDLE],
        lureHolds: [...LURE_HOLDS],
        lurePosture: { ...LURE_POSTURE },
      },
    };

    const qualificationMessage = proof.timedOut || !proof.complete
      ? '证明超时或未闭合，禁止作为合格路线发布'
      : proof.canFinish
        ? '诱导分支仍可在剩余体力内完攀'
        : !notEarlyExhaustion
          ? '诱导姿态已经耗尽体力，不能计为成功诱导'
          : !closer
            ? '诱导姿态没有比起步位置更接近终点'
            : proof.rootLegalMoves === 0
              ? '诱导姿态后没有可站稳的合法换点，证据不足'
              : '未通过合格证明';

    route.certificate = certificate;
    route.generator = {
      generated: true,
      seed: candidateSeed,
      blueprint: BLUEPRINT_VERSION,
      status: publishable ? 'qualified' : 'unverified',
      message: publishable ? undefined : qualificationMessage,
    };

    if (publishable) {
      return { ok: true, publishable: true, route, errors: [], attempts: attempt + 1, elapsedMs: Date.now() - started };
    }
    lastErrors = [qualificationMessage];
    if (!proof.complete) break;
  }

  return {
    ok: false,
    publishable: false,
    route: lastRoute,
    errors: lastErrors.length ? lastErrors : ['生成器未能在限时内给出合格证明'],
    attempts: attemptsUsed,
    elapsedMs: Date.now() - started,
  };
}
