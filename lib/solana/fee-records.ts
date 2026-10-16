// Creator-fee record store (server-side, process scope).
//
// Every processed fee MUST carry a complete audit record:
//   transactionSignature, slot, timestamp, source, destination, amount,
//   processingId, verification status.
//
// Duplicate protection: a transaction signature can be processed exactly once
// per process lifetime; re-submission is recorded as `rejected_duplicate`, not
// silently dropped and never double-credited. In the live architecture this
// store is replaced by the on-chain FeeRecord PDA (see programs/solflow/lib.rs)
// which enforces uniqueness of the fee signature at the program level.

export type FeeVerificationStatus =
  | 'verified'
  | 'rejected_source'
  | 'rejected_destination'
  | 'rejected_amount'
  | 'rejected_failed_tx'
  | 'rejected_duplicate'
  | 'rejected_unparseable';

export interface FeeRecord {
  processingId: string;
  transactionSignature: string;
  slot: number | null;
  timestamp: number; // unix seconds (blockTime)
  source: string | null;
  destination: string | null;
  amountLamports: string; // raw lamports as decimal string (0 when unresolved)
  status: FeeVerificationStatus;
  detail: string | null;
  processedAt: number; // unix seconds
}

const records = new Map<string, FeeRecord>(); // key: transaction signature
let counter = 0;

function nextProcessingId(signature: string): string {
  counter += 1;
  const t = Date.now().toString(36);
  return `fee_${t}_${counter.toString(36)}_${signature.slice(0, 8)}`;
}

export function hasRecord(signature: string): boolean {
  return records.has(signature);
}

export function getRecord(signature: string): FeeRecord | null {
  return records.get(signature) ?? null;
}

export function allRecords(): FeeRecord[] {
  return [...records.values()].sort((a, b) => b.processedAt - a.processedAt);
}

export function recordCount(): number {
  return records.size;
}

export function verifiedRecords(): FeeRecord[] {
  return allRecords().filter((r) => r.status === 'verified');
}

export interface CreateFeeRecordInput {
  transactionSignature: string;
  slot: number | null;
  timestamp: number;
  source: string | null;
  destination: string | null;
  amountLamports: bigint | string;
  status: FeeVerificationStatus;
  detail?: string | null;
}

/** Insert a fee record; flags duplicates instead of re-crediting. */
export function createFeeRecord(input: CreateFeeRecordInput): FeeRecord {
  const existing = records.get(input.transactionSignature);
  if (existing) {
    if (existing.status !== 'rejected_duplicate') {
      existing.status = 'rejected_duplicate';
      existing.detail = 'Duplicate processing attempt — fee already recorded.';
    }
    return existing;
  }
  const rec: FeeRecord = {
    processingId: nextProcessingId(input.transactionSignature),
    transactionSignature: input.transactionSignature,
    slot: input.slot,
    timestamp: input.timestamp,
    source: input.source,
    destination: input.destination,
    amountLamports:
      typeof input.amountLamports === 'bigint'
        ? input.amountLamports.toString(10)
        : input.amountLamports,
    status: input.status,
    detail: input.detail ?? null,
    processedAt: Math.floor(Date.now() / 1000),
  };
  records.set(input.transactionSignature, rec);
  return rec;
}