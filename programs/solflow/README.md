# SOLFLOW Reference Program (NOT DEPLOYED, NOT AUDITED)

This directory documents the on-chain program architecture for SOLFLOW.
A full Anchor implementation should be generated with `anchor init solflow`
and the account/instruction layout below. The frontend does NOT depend on
this program being deployed: until `NEXT_PUBLIC_PROGRAM_ID` is configured,
the app runs in clearly-labeled DEMO MODE or reports live data as
unavailable.

## Accounts

- **GlobalState** — authority, pause flags, total shares, bump seeds
- **UserPosition** — owner, staked amount, reward debt per share, lifetime earned/claimed
- **RewardVault** — per-asset vault PDA (SOL and each reward mint)
- **RewardAsset** — mint, vault, allocation bps, rewardPerShare, totalFunded, totalDistributed, totalClaimed, enabled
- **RewardEpoch** — epoch id, start/end, rewards by asset, eligible stake, status
- **FeeSourceConfig** — whitelisted creator-fee source wallets

## Instructions

- `initialize` — create GlobalState + vaults (authority only)
- `stake(sol)` — deposit native SOL, mint shares 1:1, update reward debt
- `unstake(amount)` — sync pending, burn shares, return SOL
- `claim(asset)` — sync user against RewardAsset.rewardPerShare, transfer vault -> user
- `claim_all` — iterate all enabled RewardAssets
- `fund_rewards(asset, amount)` — authority (or verified treasury signer) tops up reward pool; updates rewardPerShare with checked math against total shares
- `configure_asset`, `set_fee_source`, `create_epoch`, `pause/unpause` — authority only

## Safety requirements

- Checked arithmetic everywhere (`checked_add/sub/mul/div`)
- Division-by-zero guards when total shares == 0 (retain funds, no rps inflation)
- Signer + authority validation on every authority instruction
- Vault PDAs signed by program; no direct lamport drains
- Duplicate-claim protection via rewardDebtPerShare checkpoint
- Decimal handling: all math in raw token units; UI converts for display only

## Deployment gates (must all be true before mainnet)

1. Anchor build + test suite green (unit + integration)
2. Independent audit completed
3. Program verified on-chain (deployed build matches published source)
4. Upgrade authority secured (multisig)
5. Treasury and fee-source addresses confirmed by the operator
