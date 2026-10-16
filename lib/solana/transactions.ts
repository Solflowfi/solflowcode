// Transaction status handling. Never marks a transaction confirmed until the
// RPC reports it; user-facing errors are surfaced, not swallowed.

export type TxOutcome = 'confirmed' | 'failed' | 'timeout';

export interface SendResult {
  signature: string | null;
  outcome: TxOutcome;
  error?: string;
}

/** Human-readable explanation for common wallet / RPC failures. */
export function explainTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('UserRejected') || msg.includes('rejected') || msg.includes('declined')) {
    return 'Transaction rejected in wallet.';
  }
  if (msg.includes('insufficient') || msg.includes('0x1')) {
    return 'Insufficient SOL for balance or fees.';
  }
  if (msg.includes('blockhash') || msg.includes('expired')) {
    return 'Transaction expired. Please retry.';
  }
  if (msg.includes('BlockheightExceeded')) {
    return 'Transaction blockhash expired. Please retry.';
  }
  if (msg.includes('simulation')) {
    return 'Transaction simulation failed. The program rejected the instruction.';
  }
  return msg.slice(0, 200);
}

/**
 * Confirm a signature with a timeout. Returns the final outcome — never a
 * fabricated success.
 */
export async function confirmTx(
  signature: string,
  timeoutMs = 60_000
): Promise<TxOutcome> {
  try {
    const { getConnection } = await import('./rpc');
    const conn = getConnection();
    const latest = await conn.getLatestBlockhash();

    let elapsed = 0;
    while (elapsed < timeoutMs) {
      const resp = await conn.getSignatureStatuses([signature]);
      const status = resp.value[0];
      if (status) {
        if (status.err) return 'failed';
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          return 'confirmed';
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
      elapsed += 2000;
    }

    void latest;
    return 'timeout';
  } catch {
    return 'failed';
  }
}
