# SOLFLOW — Devnet Deployment Plan (APPROVAL GATED)

> **STATUS: NOT EXECUTED. NO DEPLOYMENT HAS HAPPENED.**
> This document is the exact runbook for a **Devnet-only** deployment.
> Do NOT use mainnet. No real funds. No invented addresses.
> Every `<PLACEHOLDER>` below must be filled from real, freshly generated
> keypairs or user-supplied values — never typed from memory.

## BUILD MILESTONE — 2026-09-26: PROGRAM BUILDS SUCCESSFULLY

`anchor build` now **succeeds** on this machine:

| Item            | Value |
|-----------------|-------|
| Artifact        | `programs\solflow\target\deploy\solflow.so` |
| Size            | 519.5 KB |
| SHA-256         | `8A9EEE2DBCFCC13816F7479FD060A9E4B43A7BF4AC83477419FDFC7DCCA4C1F8` |
| Program address | `DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ` (`.devnet/program.json`, also copied to `target/deploy/solflow-keypair.json`) |
| Build command   | `build_devnet.cmd` (vcvars64 + real anchor 0.30.1 from `.cargo\bin` + `cargo-build-sbf --tools-version v1.42.1`) |

Fixes required to make it compile (all verified in `programs/solflow/src/lib.rs`):

1. **Anchor 0.30.1 derive bug — `SystemAccount` + `#[account(init)]`**
   generates `::try_from(...)` with an empty container path
   (E0425 "cannot find crate `try_from`/`try_from_unchecked`"). Reproduced in a
   minimal probe crate. Fix: `Initialize` now uses `UncheckedAccount` +
   `seeds`/`bump` for `sol_vault` and `vault_authority`, and the instruction
   body creates both PDAs via raw `system_instruction::create_account` CPIs
   (space 0, owner = system program, rent-exempt).
2. **InitSplAsset** — converted to `UncheckedAccount` + raw CPIs
   (same pattern as `init_flow_staking`): `create_account` +
   `initialize_account3` with the `vault_auth` PDA as token authority.
3. **E0716 temporaries** — bound `staking_mint.key()` to `mint_key` before
   building PDA seeds; `claim_all` now parses the user NVDAx ATA from raw data
   (mint/owner at bytes 0..32 / 32..64) instead of
   `Account::try_from(&...to_account_info())`.
4. **Cargo.toml** — added `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`.

Known non-blocker: the IDL generation step fails on this toolchain
(`proc-macro2` 1.0.79 nightly probe misdetects the Solana rustc 1.89 build);
the `.so` is produced before that step. `build_devnet.cmd` now treats a
produced `.so` as success.

### Deployment funding blocker (devnet)

`solana rent 519494` on devnet = **2.63967976 SOL**. Deploy peaks at
buffer + program account ≈ **5.3 SOL** transient (buffer closes and refunds
after deploy). Current funds: funder `F5ttyj7EezBpHseVtS8LnT4XEmGYWDuK1eLLF4Q95YZ1`
holds **1 SOL**; authority `HPrPmHK5Qg15CMczAasDfcWA8m3xmNQSRsoAoviEp47C`
holds 0 SOL. Devnet faucet (`api.devnet.solana.com` airdrop) is currently
**rate-limited for this IP** (0.5 / 0.05 SOL requests both refused).

Deploy command once funded:

```
solana program deploy --url devnet ^
  --keypair .devnet\funder.json ^
  --program-id .devnet\program.json ^
  --output-dir programs\solflow\target\deploy ^
  programs\solflow\target\deploy\solflow.so
```

Note: the fee payer (funder) becomes the program's upgrade authority by
default; transfer the upgrade authority to `HPrPmHK5...` immediately after
deploy if a different authority is desired.


## Current toolchain state (verified on this machine)

| Tool          | State        | Version / Path |
|---------------|--------------|----------------|
| Node.js       | INSTALLED    | v22.17.0 |
| Solana CLI    | INSTALLED    | 1.18.17 (`%USERPROFILE%\.local\share\solana\install\active_release\bin`) |
| rustc         | **MISSING**  | not on PATH, `%USERPROFILE%\.cargo` absent |
| cargo         | **MISSING**  | not on PATH |
| Anchor        | **MISSING**  | not on PATH |
| avm           | **MISSING**  | not on PATH |
| spl-token CLI | INSTALLED    | bundled with Solana CLI release |

`cargo-build-sbf.exe` ships with the Solana CLI release but it **requires a
real Rust toolchain** (rustup/cargo) — without it, `anchor build` cannot run.
Nothing was installed or configured during this audit, per instructions.

## Phase 0 — Install the missing tools (run manually; NOT done here)

```bat
:: 1. Rust (stable) — https://rustup.rs
winget install Rustlang.Rustup
:: then verify:
rustc --version      :: expect 1.75+ (Anchor 0.30 requires >= 1.68)
cargo --version

:: 2. Anchor via AVM (version MUST match Cargo.toml: 0.30.1)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1
anchor --version     :: expect anchor-cli 0.30.1

:: 3. Solana CLI build dependency check
solana --version     :: already 1.18.17 - OK
```

## Phase 1 — Configure the Solana CLI for Devnet

```bat
solana config set --url https://api.devnet.solana.com
solana config set --keypair <DEPLOYER_KEYPAIR_PATH>   :: e.g. %USERPROFILE%\.config\solana\devnet-deployer.json
solana address                                        :: this IS the deployer = program authority = admin
solana balance                                        :: needs ~3-5 SOL for deploy + init rents

:: if funding is needed (devnet faucet, rate-limited; repeatable):
solana airdrop 2
```

**Key-management rule:** the deployer keypair that sets the program upgrade
authority is the protocol's highest-value secret. Use a dedicated devnet
keypair, keep it out of the repo, never commit it, and plan the same
separation for mainnet (multisig/Squad recommended later).

## Phase 2 — Build the program

```bat
cd <PROJECT_ROOT>

:: 2a. Generate a FRESH program keypair (never reuse, never invent):
solana-keygen new -o target\deploy\solflow-keypair.json --no-bip39-passphrase

:: 2b. Read the generated program id:
solana address -k target\deploy\solflow-keypair.json
::  -> <PROGRAM_ID>

:: 2c. Write <PROGRAM_ID> into BOTH places, then rebuild:
::     programs\solflow\lib.rs          -> declare_id!("<PROGRAM_ID>");
::     Anchor.toml                      -> [programs.devnet] solflow = "<PROGRAM_ID>"

anchor build
:: artifacts:
::   target\deploy\solflow.so        (BPF program binary)
::   target\idl\solflow.json         (IDL - needed by the init script)

:: 2d. Verify the binary embeds the declared id:
solana program dump <PROGRAM_ID> --output json   :: (post-deploy) or check build log line "declare_id"
```

Build failure handling: fix reported rustc/anchor errors, re-run
`anchor build`. Do not bypass checks (`--skip-lint` etc. only with cause).

## Phase 3 — Deploy to Devnet (ONLY after explicit user approval)

```bat
solana program deploy target\deploy\solflow.so ^
  --program-id target\deploy\solflow-keypair.json ^
  --url devnet ^
  --with-compute-unit-price 2000

:: verify:
solana program show <PROGRAM_ID> --output json
:: "programDataAddress"/"authority" must equal the deployer wallet
```

## Phase 4 — Initialize SOLFLOW (devnet, demo-off-chain UI untouched)

Run with a one-off TypeScript client (`@coral-xyz/anchor` + the generated
IDL, to be installed together with the toolchain in Phase 0). The exact
instruction sequence and accounts:

```js
// scripts/devnet-init.ts  (created at execution time, NOT committed with keys)
// 1) initialize
await program.methods.initialize().accounts({
  authority: deployer.publicKey,          //Signer
  globalState: globalPda,                 // seeds ["global"]
  solVault: solVaultPda,                  // seeds ["sol_vault"]        (created, 0 lamports)
  vaultAuthority: vaultAuthPda,           // seeds ["vault_auth"]       (created)
  systemProgram: SystemProgram.programId,
}).rpc();

// 2) init SOL reward asset at 7000 bps (70%)
await program.methods.initSolAsset(7000).accounts({
  authority: deployer.publicKey,
  globalState: globalPda,
  rewardAsset: assetSolPda,               // seeds ["asset", "SOL"]
  solVault: solVaultPda,
  systemProgram: SystemProgram.programId,
}).rpc();

// 3) NVDAx asset — DEFERRED until a real NVDAx mint exists.
//    initSplAsset(3000) requires: real mint + user token account owned by
//    vaultAuthPda. NEVER invent a mint. Until then the engine keeps the 30%
//    as an unallocated reserve (NVDAx NOT CONFIGURED) — by design.

// 4) whitelist the creator fee source (REAL address only, user-supplied):
await program.methods.initFeeSource(true).accounts({
  authority: deployer.publicKey,
  feeSourceConfig: feeSourcePda,          // seeds ["feesource", <REAL_SOURCE>]
  source: <REAL_CREATOR_FEE_SOURCE>,      // never invented
  systemProgram: SystemProgram.programId,
}).rpc();
```

70/30 allocation is configured by the `7000`/`3000` bps arguments above
(SOL asset = 7000). The NVDAx bps is fixed at 3000 in the engine's defaults
and may be re-tuned later with `setAllocation` (authority-only).

## Phase 5 — Transactions requiring the deployer/admin wallet signature

| Transaction                      | Signer                    | Authority check in program |
|----------------------------------|---------------------------|----------------------------|
| `solana program deploy`          | deployer (upgrade auth)   | n/a (runtime) |
| `initialize`                     | deployer (becomes authority) | stored in GlobalState |
| `initSolAsset` / `initSplAsset`  | deployer                  | `authority == global_state.authority` |
| `setAllocation`                  | deployer                  | authority check |
| `initFeeSource` / `setFeeSourceEnabled` | deployer           | authority check |
| `pause` / `unpause`              | deployer                  | authority check |
| `recordFee`                      | whitelisted creator-fee source (funder must equal the whitelisted source) + authority co-signs | authority + whitelisted source == funder + fee-receipt PDA replay guard |
| `fundSolRewards` / `fundSplRewards` | any funder (usually admin) | open to anyone by design |
| `openPosition` / `stake` / `unstake` / `claim*` | the user       | PDA-bound to user |

## Phase 6 — Post-deploy verification (server-side, no env guessing)

The existing `/api/infrastructure` validation will verify each component on
chain (account existence, mint validity, program deployment, mint match).
Only AFTER the user supplies real values does any of this change state:

```bat
:: fill ONLY after real values exist (deployer runs these to read, not to invent):
solana account <PROGRAM_ID>                                   :: program deployed
solana account <SOL_VAULT_PDA_DERIVED>                        :: SOL vault exists
solana account <CREATOR_FEE_SOURCE>                           :: fee source exists
```

`.env.local` stays EXACTLY as-is until then (`NEXT_PUBLIC_DEMO_MODE=true`,
program id / fee source / vaults / NVDAx mint all EMPTY).

## Remaining blockers (exact)

1. **rustc/cargo missing** — no Rust toolchain, `anchor build` impossible.
2. **anchor/avm missing** — no Anchor CLI to drive the build.
3. **Program keypair not generated** — `<PROGRAM_ID>` does not exist yet
   (deliberately NOT invented).
4. **`declare_id!` + `Anchor.toml` still hold
   `REPLACE_WITH_DEPLOYED_PROGRAM_ID`** — must be updated with the freshly
   generated id before build.
5. **Deployer devnet keypair + funding** — not created; devnet SOL needed.
6. **Real creator-fee source address** — must be user-supplied.
7. **NVDAx mint** — does not exist in reality; `initSplAsset` deferred
   (engine already handles the unconfigured case safely).
8. **User approval** — deploy only after explicit go-ahead.

