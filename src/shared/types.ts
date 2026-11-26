export type Limb = 'lh' | 'rh' | 'lf' | 'rf';
export type Contacts = Record<Limb, string>;
export type HoldKind = 'jug' | 'edge' | 'slope' | 'step';

export interface Point {
  x: number;
  y: number;
}

export interface Hold extends Point {
  id: string;
  kind: HoldKind;
  angle: number;
}

export interface Route {
  id: string;
  name: string;
  grade: string;
  color: string;
  tilt: number;
  energy: number;
  start: Contacts;
  finish: string;
  holds: Hold[];
  costScale?: number;
  generator?: RouteGeneratorInfo;
  certificate?: RouteCertificate;
}

export interface MaterialQuota extends Record<HoldKind, number> {}

export interface GeneratorInput {
  holdCount: number;
  quota: MaterialQuota;
  energy: number;
  start: Point;
  finish: Point;
  seed: number;
  proofLimitMs: number;
}

export interface RouteLineEvidence {
  id: 'A' | 'B';
  name: string;
  middleHolds: string[];
  moves: MoveRecord[];
  cost: number;
  remaining: number;
}

export interface LureEvidence {
  name: string;
  posture: Contacts;
  moves: MoveRecord[];
  cost: number;
  remaining: number;
  closerDistance: number;
  splitDistance: number;
  proof: DeadBranchCertificate;
}

export interface DeadBranchCertificate {
  complete: boolean;
  canFinish: boolean;
  timedOut: boolean;
  statesVisited: number;
  transitionsChecked: number;
  safeMovesChecked?: number;
  rootLegalMoves: number;
  rootBlockedMoves?: number;
  elapsedMs: number;
  limitMs: number;
  rootBranches: RootBranchCoverage[];
}

export interface RootBranchCoverage {
  limb: Limb;
  target: string;
  cost: number;
  energyAfter: number;
  complete: boolean;
  canFinish: boolean;
  closed: boolean;
  failure?: Failure | null;
}

export interface RouteCertificate {
  schemaVersion: 1;
  qualified: boolean;
  generatedAt: number;
  input: GeneratorInput;
  actualQuota: MaterialQuota;
  seed: number;
  attempts: number;
  elapsedMs: number;
  lines: [RouteLineEvidence, RouteLineEvidence];
  lure: LureEvidence;
  classificationHints: {
    aMiddle: string[];
    bMiddle: string[];
    lureHolds: string[];
    lurePosture: Contacts;
  };
}

export interface RouteGeneratorInfo {
  generated: true;
  seed: number;
  blueprint: string;
  status: 'qualified' | 'unverified';
  message?: string;
}

export interface Move {
  limb: Limb;
  target: string;
}

export interface Balance {
  margin: number;
  span: number;
}

export type Failure = 'reach' | 'support' | 'energy';

export interface Preview {
  move: Move;
  next: Contacts;
  cost: number;
  distance: number;
  reach: number;
  support: Balance;
  landing: Balance;
  failure: Failure | null;
}

export interface MoveRecord extends Preview {
  before: Contacts;
  energyBefore: number;
  energyAfter: number;
}

export interface Attempt {
  id: string;
  routeId: string;
  result: 'success' | 'fall';
  moves: MoveRecord[];
  at: number;
}
