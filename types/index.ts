export type TxKind =
  | "STAKE"
  | "UNSTAKE"
  | "CLAIM"
  | "REWARD"
  | "FEE";

export type TxStatus = "confirmed" | "pending" | "failed";

export interface TxRow {
  signature: string | null;
  slot: number | null;
  kind: TxKind;
  asset: string;
  amount: number | null;
  status: TxStatus;
  timestamp: number | null; // unix seconds
}

export interface RewardAssetState {
  symbol: string;
  mint: string | null;
  vault: string | null;
  allocationBps: number;
  claimable: string; // UI amount, raw string to avoid float drift
  lifetimeEarned: string;
  lifetimeClaimed: string;
  lastClaimAt: number | null;
}

export interface UserRewards {
  address: string;
  assets: RewardAssetState[];
}

export interface ProtocolStats {
  tvl: string;
  /** LEVEL 1: lifetime verified creator fees (SOL). */
  creatorFees: string;
  /** LEVEL 1: lifetime creator payouts (70% of fees). */
  creatorPayout: string;
  /** LEVEL 1: lifetime reward-pool inflow (30% of fees). */
  rewardPool: string;
  /** LEVEL 2: SOL reward allocation funded (70% of pool = 21% of fees). */
  solDistributed: string;
  /** LEVEL 2: NVDAx units credited (simulated conversion in demo). */
  nvdaDistributed: string;
  /** LEVEL 2: NVDAx allocation retained as SOL-equivalent pending conversion. */
  nvdaPendingConversion: string;
  activeStakers: number;
  currentEpoch: number | null;
}

export interface FeeEngineStats {
  /** Lifetime verified creator fees (SOL). */
  feesReceived: string;
  /** LEVEL 1: creator payouts (70% of fees). */
  creatorPayout: string;
  /** LEVEL 1: reward pool (30% of fees). */
  rewardPool: string;
  /** LEVEL 2: SOL allocation (70% of pool = 21% of fees). */
  solAllocation: string;
  /** LEVEL 2: NVDAx allocation (30% of pool = 9% of fees). */
  nvdaAllocation: string;
  /** NVDAx allocation retained pending a real conversion route. */
  nvdaPendingConversion: string;
  distributed: string;
  pendingDistribution: string;
}

export interface FeeSource {
  id: string;
  name: string;
  address: string | null;
  network: string;
  asset: string;
  verification: "verified" | "pending" | "unconfigured";
  lastTxSignature: string | null;
  lastDetectedAt: number | null;
}

// ---------- Security tab (real state only — see /api/security) ----------

export type SecurityBadge =
  | 'DEPLOYED'
  | 'NOT DEPLOYED'
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'AUDITED'
  | 'NOT AUDITED'
  | 'PINNED'
  | 'DRIFT'
  | 'PDA'
  | 'NOT LAUNCHED'
  | 'STAGING'
  | 'CONFIGURED'
  | 'AWAITING VERIFICATION'
  | 'UNCONFIGURED'
  | 'OPERATOR HELD'
  | 'MULTISIG / EXTERNAL'
  | 'IMMUTABLE'
  | 'SERVER-GATED'
  | 'GATE UNCONFIGURED'
  | 'ACTIVE'
  | 'NOT AVAILABLE'
  | 'NONE HELD';

export interface SecurityItem {
  key: string;
  label: string;
  badge: SecurityBadge;
  detail: string;
  /** Optional address for explorer links. */
  address: string | null;
  /** Optional external link (explorer / audit report). */
  link: string | null;
}

export interface SecurityReport {
  mode: 'demo' | 'live' | 'staging';
  network: string;
  /** Where the deployment check was executed (always mainnet). */
  checkedOn: 'mainnet' | 'unavailable';
  items: SecurityItem[];
  /** Server-side timestamp (unix seconds). */
  checkedAt: number;
}

export interface AnalyticsPoint {
  t: number; // unix seconds
  tvl?: number;
  fees?: number;
  solRewards?: number;
  nvdaRewards?: number;
  stakers?: number;
  distribution?: number;
  treasury?: number;
  rate?: number;
}

export interface AnalyticsSeries {
  points: AnalyticsPoint[];
  source: "demo" | "live";
}

export interface AdminStats {
  totalTvl: string;
  creatorFeeRevenue: string;
  solRewardPool: string;
  nvdaRewardPool: string;
  activeUsers: number;
  pendingClaims: number;
  completedClaims: number;
  failedTransactions: number;
  epochs: number;
}

export interface ProtocolResponse {
  mode: "demo" | "live" | "staging";
  stats: ProtocolStats | null;
  feeEngine: FeeEngineStats | null;
  sources: FeeSource[];
  epochs: RewardEpochView[];
  error?: string;
}

export interface RewardEpochView {
  id: number;
  start: number | null;
  end: number | null;
  solRewards: string;
  nvdaRewards: string;
  eligibleStake: string;
  status: "active" | "completed";
}

export type ReactNode = import("react").ReactNode;

// ---------- infrastructure readiness (server-validated) ----------

export type InfraState = 'connected' | 'not_configured' | 'invalid' | 'not_deployed';

export interface InfraComponent {
  id: string;
  label: string;
  state: InfraState;
  detail: string;
  metrics?: Record<string, string>; // verified on-chain figures (balance, decimals, supply...)
}

export interface InfrastructureStatus {
  mode: 'demo' | 'live' | 'staging';
  liveReady: boolean; // true only when every required component verifies on-chain
  missing: string[]; // human-readable list of what is not configured/invalid
  components: InfraComponent[];
}