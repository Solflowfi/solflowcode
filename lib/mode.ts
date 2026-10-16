import { getEnv } from "../config/env.ts";

/**
 * Explicit environment matrix (staging must NEVER collapse into "live"):
 *   A. DEMO               — NEXT_PUBLIC_DEMO_MODE=true
 *   B. MAINNET STAGING    — demo off + NEXT_PUBLIC_STAKING_TEST_MODE=true
 *                           with a configured dedicated staging program
 *   C. MAINNET PRODUCTION — demo off + staging off (production program/$FLOW)
 */
export type Mode = "demo" | "staging" | "live";

export function getMode(): Mode {
  const env = getEnv();
  if (env.demoMode) return "demo";
  if (env.stakingTestMode && env.stagingProgramId) return "staging";
  return "live";
}

