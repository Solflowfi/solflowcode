// Off-chain conversion records — idempotency / replay protection for the
// SOL -> NVDAx conversion + funding flow. SERVER ONLY.
//
// State machine:
//   quoted -> awaiting_signature -> submitted -> confirmed -> funded
//     \______________________ any state -> failed _______________________/
//
// A conversion is NEVER 'funded' until the on-chain fund_spl_rewards
// transaction has been observed AND verified via RPC. Swap signatures and
// funding signatures are single-use: the same Jupiter swap or the same
// funding transaction can never be credited twice.
//
// STORAGE NOTE: records live in the server process (globalThis singleton so
// dev hot-reload keeps them). Serverless instances are ephemeral — the
// authoritative replay protection for reward accounting is the on-chain
// program itself (fund_spl_rewards credits the vault ledger exactly once per
// real transfer); these records prevent double-swap / double-credit within
// an instance and are the operator's audit trail.

export type ConversionStatus = 'quoted' | 'awaiting_signature' | 'submitted' | 'confirmed' | 'funded' | 'failed';

export interface ConversionRecord {
  requestId: string;
  status: ConversionStatus;
  operatorWallet: string;
  /** SOL lamports submitted for conversion. */
  inputLamports: number;
  /** Jupiter's quoted NVDAx raw units out (untrusted until verified). */
  quotedOutRaw: bigint;
  /** NVDAx raw units independently verified on-chain (post-swap). */
  verifiedOutRaw: bigint | null;
  nvdaMint: string;
  router: string;
  priceImpactBps: number | null;
  swapSignature: string | null;
  fundingSignature: string | null;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export class ConversionRecordError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export interface ConversionStore {
  byRequest: Map<string, ConversionRecord>;
  bySwapSig: Map<string, string>;
  byFundingSig: Map<string, string>;
}

/** Fresh isolated store (used directly by tests). */
export function newConversionStore(): ConversionStore {
  return { byRequest: new Map(), bySwapSig: new Map(), byFundingSig: new Map() };
}

const g = globalThis as { __solflowConversions?: ConversionStore };

/** Process-wide store (tests use newConversionStore() instead). */
export function conversionStore(): ConversionStore {
  if (!g.__solflowConversions) g.__solflowConversions = newConversionStore();
  return g.__solflowConversions;
}

export function createRecord(
  store: ConversionStore,
  data: {
    requestId: string;
    operatorWallet: string;
    inputLamports: number;
    quotedOutRaw: bigint;
    nvdaMint: string;
    router: string;
    priceImpactBps: number | null;
  },
): ConversionRecord {
  if (store.byRequest.has(data.requestId)) {
    throw new ConversionRecordError('Duplicate requestId — this Jupiter order was already processed.', 409);
  }
  const now = Date.now();
  const rec: ConversionRecord = {
    ...data,
    status: 'quoted',
    verifiedOutRaw: null,
    swapSignature: null,
    fundingSignature: null,
    createdAt: now,
    updatedAt: now,
  };
  store.byRequest.set(data.requestId, rec);
  return rec;
}

export function getRecord(store: ConversionStore, requestId: string): ConversionRecord | null {
  return store.byRequest.get(requestId) ?? null;
}

export function listRecords(store: ConversionStore, limit = 25): ConversionRecord[] {
  return [...store.byRequest.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

function update(store: ConversionStore, requestId: string, patch: Partial<ConversionRecord>, status: ConversionStatus): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  rec.status = status;
  rec.updatedAt = Date.now();
  Object.assign(rec, patch);
  return rec;
}

export function markAwaitingSignature(store: ConversionStore, requestId: string): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  if (rec.status !== 'quoted') throw new ConversionRecordError('Conversion ' + requestId + ' is ' + rec.status + ', expected quoted.', 409);
  return update(store, requestId, {}, 'awaiting_signature');
}

/** Transition to submitted once Jupiter accepted the signed transaction. */
export function markSubmitted(store: ConversionStore, requestId: string, swapSignature: string): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  if (rec.status !== 'quoted' && rec.status !== 'awaiting_signature') {
    throw new ConversionRecordError('Conversion ' + requestId + ' is ' + rec.status + ' — cannot execute again.', 409);
  }
  const owner = store.bySwapSig.get(swapSignature);
  if (owner && owner !== requestId) {
    throw new ConversionRecordError('Swap signature already credited to another conversion (replay rejected).', 409);
  }
  store.bySwapSig.set(swapSignature, requestId);
  return update(store, requestId, { swapSignature }, 'submitted');
}

/** Transition to confirmed ONLY after independent on-chain verification. */
export function markConfirmed(store: ConversionStore, requestId: string, verifiedOutRaw: bigint): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  if (rec.status !== 'submitted') throw new ConversionRecordError('Conversion ' + requestId + ' is ' + rec.status + ', expected submitted.', 409);
  if (verifiedOutRaw <= 0n) throw new ConversionRecordError('Refusing to confirm a conversion with zero verified NVDAx output.', 422);
  return update(store, requestId, { verifiedOutRaw }, 'confirmed');
}

/**
 * Transition to funded ONLY after the on-chain fund_spl_rewards transaction
 * was observed and verified. Duplicate funding signatures are rejected.
 */
export function markFunded(store: ConversionStore, requestId: string, fundingSignature: string): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  if (rec.status === 'funded') throw new ConversionRecordError('Conversion ' + requestId + ' is already funded — duplicate funding rejected.', 409);
  if (rec.status !== 'confirmed') throw new ConversionRecordError('Conversion ' + requestId + ' is ' + rec.status + ' — funding not allowed until the swap is on-chain verified.', 409);
  const owner = store.byFundingSig.get(fundingSignature);
  if (owner) {
    throw new ConversionRecordError('Funding signature already credited (to conversion ' + owner + ') — duplicate funding rejected.', 409);
  }
  store.byFundingSig.set(fundingSignature, requestId);
  return update(store, requestId, { fundingSignature }, 'funded');
}

export function markFailed(store: ConversionStore, requestId: string, error: string): ConversionRecord {
  const rec = store.byRequest.get(requestId);
  if (!rec) throw new ConversionRecordError('Unknown conversion requestId.', 404);
  if (rec.status === 'funded') throw new ConversionRecordError('Conversion ' + requestId + ' is already funded; cannot mark failed.', 409);
  return update(store, requestId, { error }, 'failed');
}
