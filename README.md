# SOLFLOW

**Creator Fees. Multi-Asset Rewards.**

SOLFLOW is a Solana-native reward protocol. Users stake SOL and earn rewards in
SOL and NVDA, funded by eligible creator-fee revenue that flows into the
protocol reward engine.

> Stake into the flow. Earn SOL + NVDA.

## Status: DEMO MODE (default)

The app ships in clearly-labeled demo mode (`NEXT_PUBLIC_DEMO_MODE=true`).
No real funds are used. Reward accounting runs the same `rewardPerShare` /
`rewardDebt` model as the reference program, but on a local demo ledger that
resets on server restart. Every page displays a `DEMO MODE — NO REAL FUNDS`
banner.

With `NEXT_PUBLIC_DEMO_MODE=false`, the app reads only real data. If live
data cannot be verified (program not deployed, RPC unavailable, treasury not
configured) the UI shows **Live data unavailable** — it never substitutes
fake numbers.

## Quick start

```bash
npm install
copy .env.example .env.local   # fill in what you have; demo works out of the box
npm run dev
```

Then open http://localhost:3000.

- `npm run dev` — start in demo mode (default)
- `npm run build` / `npm start` — production build and serve
- `npm run lint` — ESLint (clean)
- `npm run typecheck` — tsc --noEmit (clean)

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing: hero, animated fee flow, live protocol metrics, how it works |
| `/app` | Dashboard: portfolio, stake, unstake, reward cards |
| `/earn` | Dedicated stake/unstake + position summary |
| `/rewards` | Multi-asset reward dashboard with CLAIM SOL / CLAIM NVDA / CLAIM ALL |
| `/fees` | Creator Fee Engine: where rewards come from + configured fee sources |
| `/activity` | Transaction history with Solscan links |
| `/analytics` | TVL, fees, distribution, stakers charts with time filters |
| `/transparency` | Proof of Yield: treasury, vaults, program, fee sources |
| `/security` | Honest security status (program, audit, authorities, keys) |
| `/admin` | Wallet-gated admin dashboard (requires server-side `ADMIN_WALLET`) |

API routes: `/api/protocol`, `/api/fees`, `/api/rewards`, `/api/analytics`,
`/api/transactions`, `/api/prices`, `/api/admin`, `/api/webhooks/Alchemy`.

## Environment

See `.env.example`. Key variables:

- `NEXT_PUBLIC_SOLANA_NETWORK` — `mainnet-beta` | `devnet` | `testnet`
- `NEXT_PUBLIC_SOLANA_RPC_URL` — custom RPC (e.g. your Alchemy Solana endpoint)
- `NEXT_PUBLIC_DEMO_MODE` — `true` (default) or `false`
- `NEXT_PUBLIC_FLOW_MINT` - $FLOW staking token mint (users stake FLOW; empty = demo)
- `NEXT_PUBLIC_PROGRAM_ID` — deployed program (empty = demo/live-unavailable)
- `NEXT_PUBLIC_REWARD_TREASURY` — treasury that receives creator fees
- `NEXT_PUBLIC_CREATOR_FEE_SOURCES` — comma-separated watched fee wallets
- `NEXT_PUBLIC_NVDA_MINT` — the REAL NVDA token mint (operator-supplied)
- `NEXT_PUBLIC_SOL_REWARD_ALLOCATION_BPS`, `NEXT_PUBLIC_NVDA_REWARD_ALLOCATION_BPS`
- `Alchemy_API_KEY` — **server-side only**
- `ADMIN_WALLET` — wallet allowed to view `/admin` data (server-side only)

Never commit real secrets. The app never holds private keys.

## Architecture

```
config/            env + token configuration (shared, no secrets)
lib/solana/        RPC, fees, tokens, transactions, reward engine
lib/providers/     Alchemy (server-only), price provider abstraction
lib/rewards/       rewardPerShare accounting core (BigInt)
lib/data.ts        API data layer (demo engine | live reads)
hooks/             useProtocolData, usePortfolio, useStaking
components/        layout, dashboard, flow, common UI
app/               pages + API routes
programs/solflow/  reference Anchor program architecture (NOT deployed)
```

Reward model (per asset):

```
rewardPerShare += newRewards / totalEligibleShares
pending         = shares * (rewardPerShare - rewardDebtPerShare) / 1e12
```

Zero-share pools retain rewards without inflating `rewardPerShare`.
Claims are protected against double-claim by the debt checkpoint.
All math is BigInt on raw token units.

## Honest-data rules

- No fake blockchain data, transactions, APY, or treasury balances
- NVDA mint is never invented — operator must configure it
- No audit is claimed (none exists)
- Creator fees are only counted from configured, validated sources
- Solscan links are generated from real addresses/signatures only
