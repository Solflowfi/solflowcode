// ===========================================================================
// SOLFLOW MAINNET STAGING PROGRAM ($TST staging deployment).
// Generated from programs/solflow/src/lib.rs — the ONLY change is the
// declare_id below (staging keypair/ID). Keep this file in sync with the
// production source on every program change.
// PRODUCTION program ID (untouched): DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ
// ===========================================================================

//! SOLFLOW staking program - production reference implementation.
//!
//! STATUS: NOT DEPLOYED, NOT AUDITED. Do not deploy without an independent
//! security review. This program is the on-chain source of truth for:
//!   - SPL staking of the $FLOW token (NEXT_PUBLIC_FLOW_MINT on the client;
//!     registered on-chain via init_flow_staking). Shares accrue 1:1 with
//!     staked raw FLOW units. SOL is NEVER a staking asset.
//!   - TWO-LEVEL creator-fee economics (see CREATOR_FEE_BPS block below):
//!       Level 1: 70% of every verified fee -> creator payout account
//!                30% -> SOLFLOW reward pool
//!       Level 2: of that pool, 70% -> SOL rewards (21% of the fee)
//!                       and 30% -> NVDAx allocation (9% of the fee)
//!   - the NVDAx allocation arrives as SOL and is held in the dedicated
//!     `nvda_pending` vault until a real SOL->NVDAx conversion route funds
//!     the SPL vault via fund_spl_rewards. It is NEVER redirected into SOL
//!     rewards and NEVER credited to users as imaginary NVDAx.
//!   - fully separated per-asset reward accounting (SOL vs NVDAx buckets)
//!   - creator-fee ingestion with signature replay protection
//!   - emergency pause (authority only)
//!
//! Accounting (integer math only, no floats, checked everywhere):
//!   reward_per_share      += new_rewards * 1e12 / total_shares
//!   pending(asset, user)   = shares * (rps - reward_debt_per_share) / 1e12
//!
//! Per-asset debt accounts (UserAssetDebt, one per user x asset) guarantee
//! the accounting-separation invariant: a SOL claim can never consume NVDAx
//! accruals and vice versa.
//!
//! Funds flow:
//!   user FLOW -> staking vault (stake) and back (unstake). This is the ONLY
//!   token the program accepts from stakers.
//!   verified creator fee -> record_fee ->
//!     70%  creator payout account (authority-configurable)
//!     21%  sol_vault -> SOL reward asset (70% of the reward pool)
//!      9%  nvda_pending vault (30% of the reward pool; awaits conversion)
//!   claims pay from vaults. Rewards funded while total_shares == 0 are
//!   retained in the asset's unshared pool and distributed with the next
//!   funding - never lost, never inflating reward_per_share.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, program::invoke_signed, system_instruction};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};
// Token-2022 support for the NVDAx reward path (types are extension-aware;
// `token_2022` / `token_2022_extensions` are default features of anchor-spl).
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{self, TokenInterface};

declare_id!("s4VqR5ayvD3PALEiBFTdMBEdy6beN9YtNesG3BsBBFW");

/// rewardPerShare scaling factor.
pub const SHARE_SCALE: u128 = 1_000_000_000_000;

// ---------- creator-fee economics (TWO explicit levels) ----------
//
// LEVEL 1 — creator fee split (of every verified creator fee):
//   CREATOR_PAYOUT_BPS -> the authority-configured creator payout account
//   REWARD_POOL_BPS    -> the SOLFLOW reward pool
//
// LEVEL 2 — reward pool split (of the LEVEL 1 reward pool):
//   SOL_REWARD_BPS     -> SOL reward allocation (21% of the fee)
//   NVDAX_REWARD_BPS   -> NVDAx allocation (9% of the fee); held as SOL in
//                         the nvda_pending vault until converted to NVDAx.
//
// Effective split of 100 SOL of creator fees:
//   70 SOL creator · 21 SOL SOL-rewards · 9 SOL NVDAx-allocation.
/// Denominator for all bps fields (100%).
pub const CREATOR_FEE_BPS: u64 = 10000;
/// Level 1: creator share of every verified creator fee.
pub const CREATOR_PAYOUT_BPS: u64 = 7000;
/// Level 1: reward-pool share of every verified creator fee (10000 - payout).
pub const REWARD_POOL_BPS: u64 = 3000;
/// Level 2: SOL share OF THE REWARD POOL (not of the whole fee).
pub const SOL_REWARD_BPS: u64 = 7000;
/// Level 2: NVDAx share OF THE REWARD POOL (not of the whole fee).
pub const NVDAX_REWARD_BPS: u64 = 3000;

pub const ASSET_SOL: &[u8] = b"SOL";
pub const ASSET_NVDAX: &[u8] = b"NVDAX";

/// The canonical NVDAx reward mint — verified live on Solana mainnet
/// (Token-2022, 8 decimals, "NVIDIA xStock" / "NVDAx"). The entire NVDAx
/// reward path is pinned to this exact mint.
pub const NVDA_MINT: Pubkey = pubkey!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");

#[error_code]
pub enum SolflowError {
    #[msg("Operation paused by authority")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Division by zero")]
    DivideByZero,
    #[msg("Insufficient staked shares")]
    InsufficientShares,
    #[msg("Unauthorized: authority signature required")]
    Unauthorized,
    #[msg("Reward asset is disabled or unknown")]
    AssetDisabled,
    #[msg("Allocation bps invalid: must be 1..=10000, assets must sum to 10000")]
    InvalidAllocation,
    #[msg("Fee source is not whitelisted")]
    FeeSourceNotAllowed,
    #[msg("Fee signature already processed (replay rejected)")]
    FeeReplay,
    #[msg("Vault balance insufficient for payout")]
    InsufficientVault,
    #[msg("Token account mint mismatch")]
    MintMismatch,
    #[msg("Malformed or untrusted account layout")]
    BadAccountLayout,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("NVDAx reward path requires the Token-2022 program")]
    WrongTokenProgram,
    #[msg("Creator payout destination is not configured")]
    CreatorPayoutNotConfigured,
    #[msg("Operator treasury is not configured")]
    TreasuryNotConfigured,
    #[msg("Pending NVDAx allocation is insufficient for this withdrawal")]
    NvdaPendingInsufficient,
}

// ---------- on-chain state ----------

#[account]
pub struct GlobalState {
    pub authority: Pubkey,
    pub paused: bool,
    pub total_shares: u64,
    pub total_fees_received: u64,
    /// The $FLOW staking token mint (registered via init_flow_staking).
    /// Shares are raw FLOW units; SOL is reward-only and never staked.
    pub staking_mint: Pubkey,
    /// LEVEL 1: destination of the creator share (CREATOR_PAYOUT_BPS) of
    /// every verified creator fee. Authority-configurable, never hardcoded.
    pub creator_payout: Pubkey,
    /// Operator/protocol treasury, PINNED at initialize and changeable only
    /// by the authority (set_treasury). record_fee never accepts an arbitrary
    /// treasury account: its only outputs are the pinned creator payout, the
    /// PDA-derived sol_vault and the PDA-derived nvda_pending vault. Any
    /// future treasury flow must read this pinned field.
    pub treasury: Pubkey,
    pub sol_vault_bump: u8,
    pub vault_authority_bump: u8,
    pub staking_vault_bump: u8,
    /// PDA vault holding the NVDAx allocation (as SOL) pending conversion.
    pub nvda_pending_vault_bump: u8,
    /// Lifetime creator payouts sent to `creator_payout` (lamports).
    pub total_creator_payout: u64,
    /// Accounting mirror of the lamports currently held by the nvda_pending
    /// vault (9% of each fee awaiting SOL->NVDAx conversion).
    pub nvda_pending_lamports: u64,
    pub bump: u8,
}
// space = 8 + 32 + 1 + 8 + 8 + 32 + 32 + 32 + 1 + 1 + 1 + 1 + 8 + 8 + 1 = 174

#[account]
pub struct RewardAsset {
    pub key: [u8; 8],           // ascii asset key, zero-padded ("SOL", "NVDAX")
    pub mint: Pubkey,           // Pubkey::default() means native SOL
    pub vault: Pubkey,          // sol_vault PDA (SOL) or vault token account (SPL)
    pub allocation_bps: u16,
    pub enabled: bool,
    pub reward_per_share: u128, // scaled by SHARE_SCALE
    pub total_funded: u128,
    pub total_distributed: u128,
    pub total_claimed: u128,
    pub unshared_pool: u128,    // funded while total_shares == 0; distributed later
    pub bump: u8,
}
// space = 8 + 8 + 32 + 32 + 2 + 1 + 16 * 5 + 1 = 164

#[account]
pub struct UserPosition {
    pub owner: Pubkey,
    pub shares: u64,
    pub created_at: i64,
    pub bump: u8,
}
// space = 8 + 32 + 8 + 8 + 1 = 57

/// One debt account per (user, asset): the accounting-separation guarantee.
/// A SOL claim touches only the SOL debt; NVDAx pending stays untouched.
#[account]
pub struct UserAssetDebt {
    pub owner: Pubkey,
    pub asset_key: [u8; 8],
    pub reward_debt_per_share: u128,
    pub pending: u128,
    pub lifetime_earned: u128,
    pub lifetime_claimed: u128,
    pub last_claim_at: i64,
    pub bump: u8,
}
// space = 8 + 32 + 8 + 16 * 4 + 8 + 1 = 121

#[account]
pub struct FeeSourceConfig {
    pub source: Pubkey,
    pub enabled: bool,
    pub bump: u8,
}
// space = 8 + 32 + 1 + 1 = 42

/// Replay guard: existence of this PDA (keyed by the fee signature) proves a
/// fee was already processed; Anchor `init` fails on existing accounts, so a
/// duplicate record_fee call for the same signature cannot fund twice.
#[account]
pub struct FeeReceipt {
    pub signature: [u8; 64],
    pub slot: u64,
    pub amount_lamports: u64,
    pub source: Pubkey,
    pub processed_at: i64,
    pub bump: u8,
}
// space = 8 + 64 + 8 + 8 + 32 + 8 + 1 = 129

// ---------- instructions ----------

#[program]
pub mod solflow {
    use super::*;

    /// Initialize global state, the native SOL reward vault and the SPL vault
    /// authority PDA. Authority becomes the first signer. The FLOW staking
    /// mint is registered separately via init_flow_staking.
    pub fn initialize(ctx: Context<Initialize>, creator_payout: Pubkey, treasury: Pubkey) -> Result<()> {
        // The creator payout destination and the operator treasury must both
        // be configured at init time; each stays authority-updatable via
        // set_creator_payout / set_treasury.
        require!(creator_payout != Pubkey::default(), SolflowError::CreatorPayoutNotConfigured);
        require!(treasury != Pubkey::default(), SolflowError::TreasuryNotConfigured);
        // Create the SOL vault, vault authority PDA and pending-NVDAx vault
        // (space 0, owned by the system program, rent-exempt) via raw CPIs —
        // anchor 0.30.1 cannot `init` a SystemAccount.
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(0);
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.sol_vault.key,
                lamports,
                0,
                ctx.accounts.system_program.key,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"sol_vault", &[ctx.bumps.sol_vault]]],
        )?;
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.vault_authority.key,
                lamports,
                0,
                ctx.accounts.system_program.key,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"vault_auth", &[ctx.bumps.vault_authority]]],
        )?;
        // Pending-NVDAx vault: holds the NVDAx allocation (as SOL) of every
        // verified creator fee until a real SOL->NVDAx conversion route is
        // executed off-program and the proceeds are funded via
        // fund_spl_rewards. NEVER used for SOL reward claims.
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.nvda_pending_vault.key,
                lamports,
                0,
                ctx.accounts.system_program.key,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.nvda_pending_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"nvda_pending", &[ctx.bumps.nvda_pending_vault]]],
        )?;

        let gs = &mut ctx.accounts.global_state;
        gs.authority = ctx.accounts.authority.key();
        gs.paused = false;
        gs.total_shares = 0;
        gs.total_fees_received = 0;
        gs.staking_mint = Pubkey::default(); // set by init_flow_staking
        gs.creator_payout = creator_payout;
        gs.treasury = treasury;
        gs.sol_vault_bump = ctx.bumps.sol_vault;
        gs.vault_authority_bump = ctx.bumps.vault_authority;
        gs.staking_vault_bump = 0; // set by init_flow_staking
        gs.nvda_pending_vault_bump = ctx.bumps.nvda_pending_vault;
        gs.total_creator_payout = 0;
        gs.nvda_pending_lamports = 0;
        gs.bump = ctx.bumps.global_state;
        emit!(Initialized {
            authority: ctx.accounts.authority.key(),
            creator_payout,
            treasury,
        });
        Ok(())
    }

    /// Authority: update the operator treasury (PINNED in GlobalState). The
    /// treasury is a fixed configuration field — instructions never accept a
    /// caller-chosen treasury account.
    pub fn set_treasury(ctx: Context<SetTreasury>, new_treasury: Pubkey) -> Result<()> {
        require!(new_treasury != Pubkey::default(), SolflowError::TreasuryNotConfigured);
        let gs = &mut ctx.accounts.global_state;
        let old_treasury = gs.treasury;
        gs.treasury = new_treasury;
        emit!(TreasuryUpdated { old_treasury, new_treasury });
        Ok(())
    }

    /// Authority: update the creator payout destination (the account that
    /// receives CREATOR_PAYOUT_BPS of every verified creator fee). Never
    /// hardcoded; validated to be non-default.
    pub fn set_creator_payout(ctx: Context<SetCreatorPayout>, new_payout: Pubkey) -> Result<()> {
        require!(new_payout != Pubkey::default(), SolflowError::CreatorPayoutNotConfigured);
        let gs = &mut ctx.accounts.global_state;
        let old_payout = gs.creator_payout;
        gs.creator_payout = new_payout;
        emit!(CreatorPayoutUpdated { old_payout, new_payout });
        Ok(())
    }

    /// Authority: release lamports from the pending-NVDAx vault to a swap
    /// funding destination. THIS IS NOT A SWAP — the released SOL must be
    /// converted to NVDAx by a real off-program route and the NVDAx proceeds
    /// funded back via fund_spl_rewards. The nvda_pending vault never funds
    /// SOL reward claims; its balance is tracked in
    /// GlobalState::nvda_pending_lamports.
    pub fn withdraw_pending_nvdax(
        ctx: Context<WithdrawPendingNvdax>,
        amount_lamports: u64,
    ) -> Result<()> {
        require!(amount_lamports > 0, SolflowError::ZeroAmount);
        let gs = &mut ctx.accounts.global_state;
        require!(
            amount_lamports <= gs.nvda_pending_lamports,
            SolflowError::NvdaPendingInsufficient
        );
        // Keep the vault alive: require the source to stay rent-exempt.
        let rent_min = Rent::get()?.minimum_balance(0);
        require!(
            ctx.accounts.nvda_pending_vault.lamports() >= amount_lamports + rent_min,
            SolflowError::NvdaPendingInsufficient
        );
        invoke_signed(
            &system_instruction::transfer(
                ctx.accounts.nvda_pending_vault.key,
                ctx.accounts.swap_destination.key,
                amount_lamports,
            ),
            &[
                ctx.accounts.nvda_pending_vault.to_account_info(),
                ctx.accounts.swap_destination.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"nvda_pending", &[gs.nvda_pending_vault_bump]]],
        )?;
        gs.nvda_pending_lamports = gs
            .nvda_pending_lamports
            .checked_sub(amount_lamports)
            .ok_or(SolflowError::Overflow)?;
        emit!(NvdaPendingWithdrawn {
            amount: amount_lamports,
            destination: ctx.accounts.swap_destination.key(),
            remaining: gs.nvda_pending_lamports,
        });
        Ok(())
    }

    /// Authority: register the $FLOW staking token mint and create the staking
    /// vault token account (PDA `flow_vault` seeded with the mint key, owned
    /// by the vault_auth PDA so the program can sign unstake transfers).
    /// Users stake FLOW into this vault; SOL is reward-only and never staked.
    /// The vault is created via raw CPIs (system create_account + token
    /// initialize_account3) to keep the Accounts context free of
    /// token::init constraints.
    pub fn init_flow_staking(ctx: Context<InitFlowStaking>) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;

        // Validate the staking mint: must be a real SPL Token mint.
        let mint_info = ctx.accounts.staking_mint.to_account_info();
        // STAGING ($TST): the staking mint may be classic SPL **or** Token-2022
        // (pump.fun-style mints are Token-2022). Accept both token programs;
        // the mint layout must still be a valid Mint (>= 82 bytes) and must
        // NOT be a wallet/system account.
        require!(
            *mint_info.owner == token::ID || *mint_info.owner == token_interface::ID,
            SolflowError::MintMismatch
        );
        let mint_data = mint_info.try_borrow_data().map_err(|_| error!(SolflowError::MintMismatch))?;
        require!(mint_data.len() >= 82, SolflowError::MintMismatch);

        gs.staking_mint = ctx.accounts.staking_mint.key();
        gs.staking_vault_bump = ctx.bumps.staking_vault;

        // Create the staking vault as a standard SPL token account
        // (space 165, owner = token program), funded by the authority.
        let rent = Rent::get()?;
        let space = TokenAccount::LEN;
        let lamports = rent.minimum_balance(space);
        let mint_key = ctx.accounts.staking_mint.key();
        let vault_seeds: &[&[u8]] = &[
            b"flow_vault",
            mint_key.as_ref(),
            &[ctx.bumps.staking_vault],
        ];
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.staking_vault.key,
                lamports,
                space as u64,
                ctx.accounts.token_program.key,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.staking_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Initialize the vault: authority = vault_auth PDA (program signs
        // all future vault operations; initialize_account3 is permissionless).
        invoke_signed(
            &token::spl_token::instruction::initialize_account3(
                &&ctx.accounts.token_program.key(),
                ctx.accounts.staking_vault.key,
                ctx.accounts.staking_mint.key,
                ctx.accounts.vault_authority.key,
            )?,
            &[
                ctx.accounts.staking_vault.to_account_info(),
                ctx.accounts.staking_mint.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
            ],
            &[],
        )?;

        Ok(())
    }

    /// Any user: create their position and both per-asset debt accounts in
    /// one transaction. Debt accounts start zeroed (correct defaults).
    pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
        let p = &mut ctx.accounts.user_position;
        p.owner = ctx.accounts.user.key();
        p.shares = 0;
        p.created_at = Clock::get()?.unix_timestamp;
        p.bump = ctx.bumps.user_position;
        ctx.accounts.sol_debt.owner = ctx.accounts.user.key();
        ctx.accounts.sol_debt.asset_key = pad_key(ASSET_SOL);
        ctx.accounts.sol_debt.bump = ctx.bumps.sol_debt;
        ctx.accounts.nvda_debt.owner = ctx.accounts.user.key();
        ctx.accounts.nvda_debt.asset_key = pad_key(ASSET_NVDAX);
        ctx.accounts.nvda_debt.bump = ctx.bumps.nvda_debt;
        Ok(())
    }

    /// Authority: EMERGENCY PAUSE. Blocks stake, unstake and all claims.
    /// Funding keeps working so reward pools can still be prepared.
    pub fn pause(ctx: Context<AuthorityOnly>) -> Result<()> {
        ctx.accounts.global_state.paused = true;
        emit!(Paused { authority: ctx.accounts.authority.key() });
        Ok(())
    }

    /// Authority: lift the pause.
    pub fn unpause(ctx: Context<AuthorityOnly>) -> Result<()> {
        ctx.accounts.global_state.paused = false;
        emit!(Unpaused { authority: ctx.accounts.authority.key() });
        Ok(())
    }

    /// Authority: create the native SOL reward asset (allocation in bps).
    pub fn init_sol_asset(ctx: Context<InitSolAsset>, allocation_bps: u16) -> Result<()> {
        require!(allocation_bps > 0 && allocation_bps <= 10000, SolflowError::InvalidAllocation);
        let a = &mut ctx.accounts.reward_asset;
        a.key = pad_key(ASSET_SOL);
        a.mint = Pubkey::default();
        a.vault = ctx.accounts.sol_vault.key();
        a.allocation_bps = allocation_bps;
        a.enabled = true;
        a.reward_per_share = 0;
        a.total_funded = 0;
        a.total_distributed = 0;
        a.total_claimed = 0;
        a.unshared_pool = 0;
        a.bump = ctx.bumps.reward_asset;
        Ok(())
    }

    /// Authority: create the SPL reward asset (e.g. NVDAx, allocation in bps).
    /// The vault token account is owned by the vault_auth PDA so the program
    /// can sign reward payouts without any external key. The vault is created
    /// via raw CPIs to keep the Accounts context free of token::init
    /// constraints.
    pub fn init_spl_asset(ctx: Context<InitSplAsset>, allocation_bps: u16) -> Result<()> {
        require!(allocation_bps > 0 && allocation_bps <= 10000, SolflowError::InvalidAllocation);

        // Validate the NVDAx mint: pinned reward mint, Token-2022 program
        // only. InterfaceAccount<token_interface::Mint> already guarantees a
        // valid extension-aware SPL mint at deserialization; here we pin the
        // exact mint and its token program.
        let mint_info = ctx.accounts.mint.to_account_info();
        require_eq!(ctx.accounts.mint.key(), NVDA_MINT, SolflowError::MintMismatch);
        require_eq!(*mint_info.owner, token_interface::ID, SolflowError::WrongTokenProgram);

        // Create the Token-2022 reward vault. Space = 165 base bytes: the
        // pinned NVDAx mint carries no extension that adds per-account state
        // (no transfer-fee, no active transfer hook), and initialize_account3
        // fails safely inside the token program if that ever changes.
        let rent = Rent::get()?;
        let space = TokenAccount::LEN;
        let lamports = rent.minimum_balance(space);
        let vault_seeds: &[&[u8]] = &[b"spl_vault", &[ctx.bumps.vault]];
        invoke_signed(
            &system_instruction::create_account(
                ctx.accounts.authority.key,
                ctx.accounts.vault.key,
                lamports,
                space as u64,
                ctx.accounts.token_program.key,
            ),
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Initialize the vault: authority = vault_auth PDA (Token-2022 CPI).
        invoke_signed(
            &spl_token_2022::instruction::initialize_account3(
                ctx.accounts.token_program.key,
                ctx.accounts.vault.key,
                ctx.accounts.mint.key,
                ctx.accounts.vault_authority.key,
            )?,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
            ],
            &[],
        )?;

        let a = &mut ctx.accounts.reward_asset;
        a.key = pad_key(ASSET_NVDAX);
        a.mint = ctx.accounts.mint.key();
        a.vault = ctx.accounts.vault.key();
        a.allocation_bps = allocation_bps;
        a.enabled = true;
        a.reward_per_share = 0;
        a.total_funded = 0;
        a.total_distributed = 0;
        a.total_claimed = 0;
        a.unshared_pool = 0;
        a.bump = ctx.bumps.reward_asset;
        Ok(())
    }

    /// Authority: update an asset's allocation bps (verified program account).
    pub fn set_allocation(ctx: Context<AuthorityWithAsset>, allocation_bps: u16) -> Result<()> {
        require!(allocation_bps > 0 && allocation_bps <= 10000, SolflowError::InvalidAllocation);
        let mut asset = load_asset(ctx.program_id, &ctx.accounts.reward_asset.to_account_info())?;
        asset.allocation_bps = allocation_bps;
        store_account(&ctx.accounts.reward_asset.to_account_info(), &asset)?;
        Ok(())
    }

    /// Authority: whitelist a creator-fee source wallet.
    pub fn init_fee_source(ctx: Context<InitFeeSource>, enabled: bool) -> Result<()> {
        let c = &mut ctx.accounts.fee_source_config;
        c.source = ctx.accounts.source.key();
        c.enabled = enabled;
        c.bump = ctx.bumps.fee_source_config;
        Ok(())
    }

    /// Authority: toggle a fee source on/off.
    pub fn set_fee_source_enabled(ctx: Context<AuthorityWithFeeSource>, enabled: bool) -> Result<()> {
        let c = load_fee_source(ctx.program_id, &ctx.accounts.fee_source_config.to_account_info())?;
        let mut c = c;
        c.enabled = enabled;
        store_account(&ctx.accounts.fee_source_config.to_account_info(), &c)?;
        Ok(())
    }

    /// Stake $FLOW (SPL transfer): user FLOW token account -> staking vault,
    /// shares accrue 1:1 with raw FLOW units. SOL is NEVER accepted here —
    /// it is reward-only.
    /// remaining_accounts: pairs of (reward_asset, user_asset_debt) for every
    /// enabled asset, synced BEFORE the share change (no reward loss on the
    /// stake boundary). The per-asset separation invariant holds because each
    /// pair only touches its own debt account.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;
        require!(!gs.paused, SolflowError::Paused);
        require!(amount > 0, SolflowError::ZeroAmount);

        sync_all(
            ctx.program_id,
            &ctx.accounts.user_position.owner,
            ctx.accounts.user_position.shares,
            ctx.remaining_accounts,
        )?;

        // SPL transfer: user FLOW ATA -> staking vault. Signed by the user.
        token_interface::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_interface::Transfer {
                    from: ctx.accounts.user_flow_ata.to_account_info(),
                    to: ctx.accounts.staking_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let p = &mut ctx.accounts.user_position;
        p.shares = p.shares.checked_add(amount).ok_or(SolflowError::Overflow)?;
        gs.total_shares = gs.total_shares.checked_add(amount).ok_or(SolflowError::Overflow)?;
        emit!(Staked {
            user: ctx.accounts.user.key(),
            amount,
            total_shares: gs.total_shares,
        });
        Ok(())
    }

    /// Unstake $FLOW: sync every asset first (pending rewards are accounted
    /// for in the user's per-asset debt accounts), then return FLOW from the
    /// staking vault to the user's FLOW token account via a vault_auth-PDA
    /// signed CPI (no authority key involved). No SOL deposit is involved.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;
        require!(!gs.paused, SolflowError::Paused);
        require!(amount > 0, SolflowError::ZeroAmount);
        require!(ctx.accounts.user_position.shares >= amount, SolflowError::InsufficientShares);

        sync_all(
            ctx.program_id,
            &ctx.accounts.user_position.owner,
            ctx.accounts.user_position.shares,
            ctx.remaining_accounts,
        )?;

        let bump = gs.vault_authority_bump;
        let vault_info = ctx.accounts.staking_vault.to_account_info();
        let user_ata_info = ctx.accounts.user_flow_ata.to_account_info();
        let auth_info = ctx.accounts.vault_authority.to_account_info();
        let token_info = ctx.accounts.token_program.to_account_info();
        let seeds: &[&[u8]] = &[b"vault_auth", &[bump]];
        token_interface::transfer(
            CpiContext::new_with_signer(
                token_info,
                token_interface::Transfer {
                    from: vault_info,
                    to: user_ata_info,
                    authority: auth_info,
                },
                &[seeds],
            ),
            amount,
        )?;

        let p = &mut ctx.accounts.user_position;
        p.shares = p.shares.checked_sub(amount).ok_or(SolflowError::Overflow)?;
        gs.total_shares = gs.total_shares.checked_sub(amount).ok_or(SolflowError::Overflow)?;
        emit!(Unstaked {
            user: ctx.accounts.user.key(),
            amount,
            total_shares: gs.total_shares,
        });
        Ok(())
    }

    /// Fund the native SOL reward pool. When total_shares == 0 the amount is
    /// retained in the asset's unshared pool and distributed with the next
    /// funding - never lost, never inflating reward_per_share.
    pub fn fund_sol_rewards(ctx: Context<FundSol>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, SolflowError::ZeroAmount);
        let asset = &mut ctx.accounts.reward_asset;
        require!(asset.enabled && asset.key == pad_key(ASSET_SOL), SolflowError::AssetDisabled);

        invoke(
            &system_instruction::transfer(
                ctx.accounts.funder.key,
                ctx.accounts.sol_vault.key,
                amount_lamports,
            ),
            &[
                ctx.accounts.funder.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
            ],
        )?;

        let total_shares = ctx.accounts.global_state.total_shares;
        distribute(asset, amount_lamports as u128, total_shares)?;
        emit!(RewardsFunded {
            asset_key: asset.key,
            amount: amount_lamports as u128,
            reward_per_share: asset.reward_per_share,
            total_shares,
        });
        Ok(())
    }

    /// Fund the SPL (NVDAx) reward pool with tokens.
    pub fn fund_spl_rewards(ctx: Context<FundSpl>, amount: u64) -> Result<()> {
        require!(amount > 0, SolflowError::ZeroAmount);
        let asset = &mut ctx.accounts.reward_asset;
        require!(asset.enabled && asset.key == pad_key(ASSET_NVDAX), SolflowError::AssetDisabled);
        // NVDAx reward path: pinned mint + Token-2022 program only.
        require_eq!(asset.mint, NVDA_MINT, SolflowError::MintMismatch);
        require_eq!(ctx.accounts.token_program.key(), token_interface::ID, SolflowError::WrongTokenProgram);
        require_eq!(ctx.accounts.vault.mint, asset.mint, SolflowError::MintMismatch);
        require_eq!(ctx.accounts.vault.key(), asset.vault, SolflowError::BadAccountLayout);

        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::Transfer {
                from: ctx.accounts.funder_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        );
        token_interface::transfer(cpi, amount)?;

        let total_shares = ctx.accounts.global_state.total_shares;
        distribute(asset, amount as u128, total_shares)?;
        emit!(RewardsFunded {
            asset_key: asset.key,
            amount: amount as u128,
            reward_per_share: asset.reward_per_share,
            total_shares,
        });
        Ok(())
    }

    /// Record a verified creator fee and route it through the TWO-LEVEL
    /// reward split.
    ///
    /// REPLAY PROTECTION: the fee receipt PDA is seeded by the fee signature
    /// (first 32 bytes). `init` fails when the account already exists, so the
    /// same fee can never be processed twice - this is the on-chain mirror of
    /// the off-chain `rejected_duplicate` fee pipeline check.
    ///
    /// ROUTING (see the CREATOR_FEE_BPS block):
    ///   100% fee -> sol_vault (transferred by the whitelisted source here)
    ///   70% (CREATOR_PAYOUT_BPS) -> creator payout account
    ///   30% (REWARD_POOL_BPS) = reward pool
    ///     of which 70% (SOL_REWARD_BPS) stays in sol_vault and funds the
    ///          SOL reward asset (21% of the fee)
    ///     and  30% (NVDAX_REWARD_BPS) moves to the nvda_pending vault
    ///          (9% of the fee) - held as SOL until a REAL conversion route
    ///          produces NVDAx that is funded via fund_spl_rewards. This
    ///          share is NEVER credited to stakers as SOL and NEVER invented
    ///          as NVDAx.
    pub fn record_fee(
        ctx: Context<RecordFee>,
        amount_lamports: u64,
        signature: [u8; 64],
        slot: u64,
    ) -> Result<()> {
        require!(amount_lamports > 0, SolflowError::ZeroAmount);

        // Fee source must be whitelisted AND the passed config account must be
        // the canonical PDA of its source (binds config <-> source, so a
        // stale or foreign config cannot vouch for a fee).
        let cfg = load_fee_source(ctx.program_id, &ctx.accounts.fee_source_config.to_account_info())?;
        require!(cfg.enabled, SolflowError::FeeSourceNotAllowed);
        let (cfg_pda, _) = Pubkey::find_program_address(
            &[b"feesource", cfg.source.as_ref()],
            ctx.program_id,
        );
        require_eq!(cfg_pda, ctx.accounts.fee_source_config.key(), SolflowError::BadAccountLayout);

        // The funding wallet must BE the whitelisted creator-fee source: the
        // recorded lamports provably leave the whitelisted source wallet in
        // this very transaction. No relayer or third party can fund a
        // "creator fee" from an unverified wallet, and the fee receipt is
        // backed by a real on-chain transfer from the configured source.
        require_eq!(ctx.accounts.funder.key(), cfg.source, SolflowError::FeeSourceNotAllowed);

        let r = &mut ctx.accounts.fee_receipt;
        r.signature = signature;
        r.slot = slot;
        r.amount_lamports = amount_lamports;
        r.source = cfg.source;
        r.processed_at = Clock::get()?.unix_timestamp;
        r.bump = ctx.bumps.fee_receipt;

        // 100% of the fee enters the SOL vault first (the funder is the
        // whitelisted creator-fee source — enforced above).
        invoke(
            &system_instruction::transfer(
                ctx.accounts.funder.key,
                ctx.accounts.sol_vault.key,
                amount_lamports,
            ),
            &[
                ctx.accounts.funder.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
            ],
        )?;

        let gs = &mut ctx.accounts.global_state;
        // LEVEL 1: creator payout — 70% of the verified fee. The passed
        // payout account must be the configured destination (no substitution).
        require!(
            gs.creator_payout != Pubkey::default(),
            SolflowError::CreatorPayoutNotConfigured
        );
        require_eq!(
            ctx.accounts.creator_payout.key(),
            gs.creator_payout,
            SolflowError::BadAccountLayout
        );
        let creator_share = (amount_lamports as u128)
            .checked_mul(CREATOR_PAYOUT_BPS as u128)
            .ok_or(SolflowError::Overflow)?
            .checked_div(CREATOR_FEE_BPS as u128)
            .ok_or(SolflowError::DivideByZero)?;
        let creator_share =
            u64::try_from(creator_share).map_err(|_| error!(SolflowError::Overflow))?;
        // The reward pool is the remainder: amount - creator_share (30%).
        let reward_pool = amount_lamports
            .checked_sub(creator_share)
            .ok_or(SolflowError::Overflow)?;

        let bump = gs.sol_vault_bump;
        if creator_share > 0 {
            let vault_info = ctx.accounts.sol_vault.to_account_info();
            let payout_info = ctx.accounts.creator_payout.to_account_info();
            let sys_info = ctx.accounts.system_program.to_account_info();
            let seeds: &[&[u8]] = &[b"sol_vault", &[bump]];
            invoke_signed(
                &system_instruction::transfer(vault_info.key, payout_info.key, creator_share),
                &[vault_info, payout_info, sys_info],
                &[seeds],
            )?;
        }

        let asset = &mut ctx.accounts.sol_asset;
        require!(asset.enabled && asset.key == pad_key(ASSET_SOL), SolflowError::AssetDisabled);

        // LEVEL 2: SOL rewards = 70% OF THE REWARD POOL (21% of the fee).
        let sol_share = (reward_pool as u128)
            .checked_mul(SOL_REWARD_BPS as u128)
            .ok_or(SolflowError::Overflow)?
            .checked_div(CREATOR_FEE_BPS as u128)
            .ok_or(SolflowError::DivideByZero)?;
        let sol_share = u64::try_from(sol_share).map_err(|_| error!(SolflowError::Overflow))?;
        // NVDAx allocation = reward_pool - sol_share (9% of the fee). It is
        // moved OUT of the SOL vault into the nvda_pending vault so it can
        // never be claimed as SOL rewards; conversion to actual NVDAx tokens
        // happens through a REAL route, after which fund_spl_rewards credits
        // the NVDAx reward pool. This share is never invented as NVDAx and
        // never silently redirected into SOL.
        let nvda_pending_amt = reward_pool
            .checked_sub(sol_share)
            .ok_or(SolflowError::Overflow)?;

        if nvda_pending_amt > 0 {
            let vault_info = ctx.accounts.sol_vault.to_account_info();
            let pending_info = ctx.accounts.nvda_pending_vault.to_account_info();
            let sys_info = ctx.accounts.system_program.to_account_info();
            let seeds: &[&[u8]] = &[b"sol_vault", &[bump]];
            invoke_signed(
                &system_instruction::transfer(vault_info.key, pending_info.key, nvda_pending_amt),
                &[vault_info, pending_info, sys_info],
                &[seeds],
            )?;
            gs.nvda_pending_lamports = gs
                .nvda_pending_lamports
                .checked_add(nvda_pending_amt)
                .ok_or(SolflowError::Overflow)?;
        }

        let total_shares = gs.total_shares;
        distribute(asset, sol_share as u128, total_shares)?;
        gs.total_fees_received = gs
            .total_fees_received
            .checked_add(amount_lamports)
            .ok_or(SolflowError::Overflow)?;
        gs.total_creator_payout = gs
            .total_creator_payout
            .checked_add(creator_share)
            .ok_or(SolflowError::Overflow)?;
        emit!(FeeRecorded {
            signature,
            slot,
            amount: amount_lamports,
            creator_payout_share: creator_share,
            reward_pool,
            sol_reward_share: sol_share,
            nvda_pending_amount: nvda_pending_amt,
            total_shares: gs.total_shares,
        });
        Ok(())
    }

    /// Claim accrued SOL rewards. Pays from the SOL vault (PDA-signed CPI),
    /// clamped to the vault balance for solvency. Only the SOL debt bucket
    /// is touched - NVDAx accruals are never consumed here.
    pub fn claim_sol(ctx: Context<ClaimSol>) -> Result<()> {
        require!(!ctx.accounts.global_state.paused, SolflowError::Paused);
        let asset = &mut ctx.accounts.reward_asset;
        require!(asset.enabled && asset.key == pad_key(ASSET_SOL), SolflowError::AssetDisabled);
        let debt = &mut ctx.accounts.user_debt;
        sync_one(asset, debt, ctx.accounts.user_position.shares)?;

        let amount = debt.pending;
        require!(amount > 0, SolflowError::NothingToClaim);
        let want = u64::try_from(amount).map_err(|_| error!(SolflowError::Overflow))?;
        let payout = want.min(ctx.accounts.sol_vault.lamports());
        require!(payout > 0, SolflowError::InsufficientVault);

        let bump = ctx.accounts.global_state.sol_vault_bump;
        let vault_info = ctx.accounts.sol_vault.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let sys_info = ctx.accounts.system_program.to_account_info();
        let seeds: &[&[u8]] = &[b"sol_vault", &[bump]];
        invoke_signed(
            &system_instruction::transfer(vault_info.key, user_info.key, payout),
            &[vault_info, user_info, sys_info],
            &[seeds],
        )?;

        debt.pending = debt.pending.checked_sub(payout as u128).ok_or(SolflowError::Overflow)?;
        debt.lifetime_claimed = debt.lifetime_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
        debt.last_claim_at = Clock::get()?.unix_timestamp;
        asset.total_claimed = asset.total_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
        emit!(Claimed { user: ctx.accounts.user.key(), asset_key: asset.key, amount: payout as u128 });
        Ok(())
    }

    /// Claim accrued NVDAx (SPL) rewards. Tokens move vault -> user ATA with
    /// the vault_auth PDA as transfer authority. Only the NVDAx debt bucket
    /// is touched - SOL accruals are never consumed here.
    pub fn claim_nvdax(ctx: Context<ClaimNvdax>) -> Result<()> {
        require!(!ctx.accounts.global_state.paused, SolflowError::Paused);
        let asset = &mut ctx.accounts.reward_asset;
        require!(asset.enabled && asset.key == pad_key(ASSET_NVDAX), SolflowError::AssetDisabled);
        // NVDAx reward path: pinned mint + Token-2022 program only.
        require_eq!(asset.mint, NVDA_MINT, SolflowError::MintMismatch);
        require_eq!(ctx.accounts.token_program.key(), token_interface::ID, SolflowError::WrongTokenProgram);
        require_eq!(ctx.accounts.vault.key(), asset.vault, SolflowError::BadAccountLayout);
        let debt = &mut ctx.accounts.user_debt;
        sync_one(asset, debt, ctx.accounts.user_position.shares)?;

        let amount = debt.pending;
        require!(amount > 0, SolflowError::NothingToClaim);
        let want = u64::try_from(amount).map_err(|_| error!(SolflowError::Overflow))?;
        let payout = want.min(ctx.accounts.vault.amount);
        require!(payout > 0, SolflowError::InsufficientVault);

        let bump = ctx.accounts.global_state.vault_authority_bump;
        let signer_seeds: &[&[u8]] = &[b"vault_auth", &[bump]];
        let binding = [signer_seeds];
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &binding,
        );
        token_interface::transfer(cpi, payout)?;

        debt.pending = debt.pending.checked_sub(payout as u128).ok_or(SolflowError::Overflow)?;
        debt.lifetime_claimed = debt.lifetime_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
        debt.last_claim_at = Clock::get()?.unix_timestamp;
        asset.total_claimed = asset.total_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
        emit!(Claimed { user: ctx.accounts.user.key(), asset_key: asset.key, amount: payout as u128 });
        Ok(())
    }

    /// Claim both canonical assets in one transaction.
    /// SOL pays to the signer wallet; NVDAx pays to nvda_user_ata only when
    /// the NVDAx asset is enabled (mint/owner validated in the body). Each
    /// asset still settles against its OWN debt account.
    pub fn claim_all(ctx: Context<ClaimAll>) -> Result<()> {
        require!(!ctx.accounts.global_state.paused, SolflowError::Paused);
        let mut sol_paid: u64 = 0;
        let mut nvda_paid: u64 = 0;

        // ---- SOL ----
        {
            let asset = &mut ctx.accounts.sol_asset;
            require!(asset.key == pad_key(ASSET_SOL), SolflowError::BadAccountLayout);
            let debt = &mut ctx.accounts.sol_debt;
            sync_one(asset, debt, ctx.accounts.user_position.shares)?;
            let amount = debt.pending;
            if amount > 0 && asset.enabled {
                let want = u64::try_from(amount).map_err(|_| error!(SolflowError::Overflow))?;
                let payout = want.min(ctx.accounts.sol_vault.lamports());
                if payout > 0 {
                    let bump = ctx.accounts.global_state.sol_vault_bump;
                    let vault_info = ctx.accounts.sol_vault.to_account_info();
                    let user_info = ctx.accounts.user.to_account_info();
                    let sys_info = ctx.accounts.system_program.to_account_info();
                    let seeds: &[&[u8]] = &[b"sol_vault", &[bump]];
                    invoke_signed(
                        &system_instruction::transfer(vault_info.key, user_info.key, payout),
                        &[vault_info, user_info, sys_info],
                        &[seeds],
                    )?;
                    debt.pending = debt.pending.checked_sub(payout as u128).ok_or(SolflowError::Overflow)?;
                    debt.lifetime_claimed = debt.lifetime_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
                    debt.last_claim_at = Clock::get()?.unix_timestamp;
                    asset.total_claimed = asset.total_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
                    sol_paid = payout;
                }
            }
        }

        // ---- NVDAx (skipped cleanly when disabled / unconfigured) ----
        {
            let asset = &mut ctx.accounts.nvda_asset;
            require!(asset.key == pad_key(ASSET_NVDAX), SolflowError::BadAccountLayout);
            // NVDAx reward path: pinned mint + Token-2022 program only.
            require_eq!(ctx.accounts.token_program.key(), token_interface::ID, SolflowError::WrongTokenProgram);
            let debt = &mut ctx.accounts.nvda_debt;
            sync_one(asset, debt, ctx.accounts.user_position.shares)?;
            if asset.enabled {
                require_eq!(asset.mint, NVDA_MINT, SolflowError::MintMismatch);
                let amount = debt.pending;
                if amount > 0 {
                    // Parse the user's NVDAx token account directly from raw
                    // data (first 32 bytes = mint, next 32 = owner).
                    let ata_data = ctx.accounts.nvda_user_ata.try_borrow_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
                    require!(ata_data.len() >= 64, SolflowError::BadAccountLayout);
                    let ata_mint = Pubkey::new_from_array(ata_data[0..32].try_into().map_err(|_| error!(SolflowError::BadAccountLayout))?);
                    let ata_owner = Pubkey::new_from_array(ata_data[32..64].try_into().map_err(|_| error!(SolflowError::BadAccountLayout))?);
                    require_eq!(ata_mint, asset.mint, SolflowError::MintMismatch);
                    require_eq!(ata_owner, ctx.accounts.user.key(), SolflowError::Unauthorized);
                    require_eq!(ctx.accounts.vault.key(), asset.vault, SolflowError::BadAccountLayout);
                    let want = u64::try_from(amount).map_err(|_| error!(SolflowError::Overflow))?;
                    let payout = want.min(ctx.accounts.vault.amount);
                    if payout > 0 {
                        let bump = ctx.accounts.global_state.vault_authority_bump;
                        let signer_seeds: &[&[u8]] = &[b"vault_auth", &[bump]];
                        let binding = [signer_seeds];
                        let cpi = CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            token_interface::Transfer {
                                from: ctx.accounts.vault.to_account_info(),
                                to: ctx.accounts.nvda_user_ata.to_account_info(),
                                authority: ctx.accounts.vault_authority.to_account_info(),
                            },
                            &binding,
                        );
                        token_interface::transfer(cpi, payout)?;
                        debt.pending = debt.pending.checked_sub(payout as u128).ok_or(SolflowError::Overflow)?;
                        debt.lifetime_claimed = debt.lifetime_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
                        debt.last_claim_at = Clock::get()?.unix_timestamp;
                        asset.total_claimed = asset.total_claimed.checked_add(payout as u128).ok_or(SolflowError::Overflow)?;
                        nvda_paid = payout;
                    }
                }
            }
        }

        require!(sol_paid > 0 || nvda_paid > 0, SolflowError::NothingToClaim);
        emit!(ClaimedAll {
            user: ctx.accounts.user.key(),
            sol_amount: sol_paid as u128,
            nvda_amount: nvda_paid as u128,
        });
        Ok(())
    }
}

// ---------- shared helpers ----------

/// Sync one asset's accrual into the user's per-asset debt bucket.
/// Mirrors lib/rewards/accounting.ts syncUser exactly.
fn sync_one(asset: &mut RewardAsset, debt: &mut UserAssetDebt, shares: u64) -> Result<()> {
    if shares > 0 && asset.reward_per_share > debt.reward_debt_per_share {
        let delta = asset.reward_per_share - debt.reward_debt_per_share;
        let accrued = (shares as u128)
            .checked_mul(delta)
            .ok_or(SolflowError::Overflow)?
            .checked_div(SHARE_SCALE)
            .ok_or(SolflowError::DivideByZero)?;
        if accrued > 0 {
            debt.pending = debt.pending.checked_add(accrued).ok_or(SolflowError::Overflow)?;
            debt.lifetime_earned = debt.lifetime_earned.checked_add(accrued).ok_or(SolflowError::Overflow)?;
            asset.total_distributed = asset.total_distributed.checked_add(accrued).ok_or(SolflowError::Overflow)?;
        }
    }
    debt.reward_debt_per_share = asset.reward_per_share;
    Ok(())
}

/// Sync every (reward_asset, user_asset_debt) pair passed via
/// remaining_accounts. Called before any share change on stake/unstake so
/// nothing is lost on the boundary. Each pair is PDA-verified against
/// (owner, asset.key) - untrusted layouts are rejected.
fn sync_all<'info>(
    program_id: &Pubkey,
    owner: &Pubkey,
    shares: u64,
    remaining: &[AccountInfo<'info>],
) -> Result<()> {
    require!(remaining.len() % 2 == 0, SolflowError::BadAccountLayout);
    for i in 0..remaining.len() / 2 {
        let asset_info = &remaining[i * 2];
        let debt_info = &remaining[i * 2 + 1];
        require_eq!(*asset_info.owner, *program_id, SolflowError::BadAccountLayout);
        require_eq!(*debt_info.owner, *program_id, SolflowError::BadAccountLayout);

        let asset_data = asset_info.try_borrow_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
        let mut asset_slice: &[u8] = &asset_data[..];
        let mut asset = RewardAsset::try_from_slice(&mut asset_slice)
            .map_err(|_| error!(SolflowError::BadAccountLayout))?;
        drop(asset_data);

        let debt_data = debt_info.try_borrow_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
        let mut debt_slice: &[u8] = &debt_data[..];
        let mut debt = UserAssetDebt::try_from_slice(&mut debt_slice)
            .map_err(|_| error!(SolflowError::BadAccountLayout))?;
        drop(debt_data);

        require!(debt.owner == *owner, SolflowError::BadAccountLayout);
        require!(debt.asset_key == asset.key, SolflowError::BadAccountLayout);
        let (expected_debt, _) = Pubkey::find_program_address(
            &[b"debt", owner.as_ref(), &asset.key],
            program_id,
        );
        require_eq!(*debt_info.key, expected_debt, SolflowError::BadAccountLayout);

        sync_one(&mut asset, &mut debt, shares)?;
        store_account(asset_info, &asset)?;
        store_account(debt_info, &debt)?;
    }
    Ok(())
}

/// Credit a funding amount to an asset pool.
/// When total_shares == 0 the amount is retained in `unshared_pool` and is
/// distributed with the NEXT funding once shares exist - funds are never
/// lost and reward_per_share is never inflated against an empty pool.
fn distribute(asset: &mut RewardAsset, amount: u128, total_shares: u64) -> Result<()> {
    asset.total_funded = asset.total_funded.checked_add(amount).ok_or(SolflowError::Overflow)?;
    if total_shares == 0 {
        asset.unshared_pool = asset.unshared_pool.checked_add(amount).ok_or(SolflowError::Overflow)?;
        return Ok(());
    }
    let effective = asset.unshared_pool.checked_add(amount).ok_or(SolflowError::Overflow)?;
    asset.unshared_pool = 0;
    let delta = effective
        .checked_mul(SHARE_SCALE)
        .ok_or(SolflowError::Overflow)?
        .checked_div(total_shares as u128)
        .ok_or(SolflowError::DivideByZero)?;
    asset.reward_per_share = asset.reward_per_share.checked_add(delta).ok_or(SolflowError::Overflow)?;
    Ok(())
}

/// Write a fixed-size program account back to its backing AccountInfo.
/// `AccountSerialize::try_to_vec` prepends the 8-byte discriminator, so the
/// layout round-trips byte-for-byte (sizes are fixed, no realloc needed).
fn store_account<'info, T: AccountSerialize + AnchorDeserialize + AnchorSerialize>(
    info: &AccountInfo<'info>,
    acct: &T,
) -> Result<()> {
    let mut out = acct.try_to_vec().map_err(|_| error!(SolflowError::BadAccountLayout))?;
    let mut data = info.try_borrow_mut_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
    require!(data.len() >= out.len(), SolflowError::BadAccountLayout);
    data[..out.len()].copy_from_slice(&mut out);
    Ok(())
}

/// Zero-pad an ascii asset key to the fixed 8-byte storage key.
fn pad_key(key: &[u8]) -> [u8; 8] {
    let mut out = [0u8; 8];
    for (i, b) in key.iter().take(8).enumerate() {
        out[i] = *b;
    }
    out
}

/// Load + validate a program-owned RewardAsset from a raw AccountInfo.
fn load_asset(program_id: &Pubkey, info: &AccountInfo) -> Result<RewardAsset> {
    require_eq!(*info.owner, *program_id, SolflowError::BadAccountLayout);
    let data = info.try_borrow_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
    let mut slice: &[u8] = &data[..];
    RewardAsset::try_from_slice(&mut slice).map_err(|_| error!(SolflowError::BadAccountLayout))
}

/// Load + validate a program-owned FeeSourceConfig from a raw AccountInfo.
fn load_fee_source(program_id: &Pubkey, info: &AccountInfo) -> Result<FeeSourceConfig> {
    require_eq!(*info.owner, *program_id, SolflowError::BadAccountLayout);
    let data = info.try_borrow_data().map_err(|_| error!(SolflowError::BadAccountLayout))?;
    let mut slice: &[u8] = &data[..];
    FeeSourceConfig::try_from_slice(&mut slice).map_err(|_| error!(SolflowError::BadAccountLayout))
}

// ---------- events ----------

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
    pub total_shares: u64,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub total_shares: u64,
}

#[event]
pub struct RewardsFunded {
    pub asset_key: [u8; 8],
    pub amount: u128,
    pub reward_per_share: u128,
    pub total_shares: u64,
}

#[event]
pub struct FeeRecorded {
    pub signature: [u8; 64],
    pub slot: u64,
    pub amount: u64,
    /// LEVEL 1: lamports paid to the creator payout account (70%).
    pub creator_payout_share: u64,
    /// LEVEL 1 remainder: the SOLFLOW reward pool (30%).
    pub reward_pool: u64,
    /// LEVEL 2: SOL reward allocation — 70% of the reward pool (21% of fee).
    pub sol_reward_share: u64,
    /// LEVEL 2: NVDAx allocation — 30% of the reward pool (9% of fee), held
    /// as SOL in the nvda_pending vault until a real conversion route runs.
    pub nvda_pending_amount: u64,
    pub total_shares: u64,
}

#[event]
pub struct Initialized {
    pub authority: Pubkey,
    pub creator_payout: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct CreatorPayoutUpdated {
    pub old_payout: Pubkey,
    pub new_payout: Pubkey,
}

#[event]
pub struct TreasuryUpdated {
    pub old_treasury: Pubkey,
    pub new_treasury: Pubkey,
}

#[event]
pub struct NvdaPendingWithdrawn {
    pub amount: u64,
    pub destination: Pubkey,
    pub remaining: u64,
}

#[event]
pub struct Claimed {
    pub user: Pubkey,
    pub asset_key: [u8; 8],
    pub amount: u128,
}

#[event]
pub struct ClaimedAll {
    pub user: Pubkey,
    pub sol_amount: u128,
    pub nvda_amount: u128,
}

#[event]
pub struct Paused {
    pub authority: Pubkey,
}

#[event]
pub struct Unpaused {
    pub authority: Pubkey,
}

// ---------- account contexts ----------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 142, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    /// Native SOL reward vault (system-owned PDA, lamports only). Created via
    /// raw CPI in the instruction body — anchor 0.30.1 cannot `init` a
    /// SystemAccount (broken derive codegen).
    /// CHECK: PDA address verified via seeds/bump; created in the body.
    #[account(mut, seeds = [b"sol_vault"], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    /// Authority PDA owning SPL reward vault token accounts. Created via raw
    /// CPI in the instruction body.
    /// CHECK: PDA address verified via seeds/bump; created in the body.
    #[account(mut, seeds = [b"vault_auth"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// Pending-NVDAx vault: system-owned PDA holding the NVDAx allocation
    /// (as SOL) of recorded fees until a real conversion route runs.
    /// CHECK: PDA address verified via seeds/bump; created in the body.
    #[account(mut, seeds = [b"nvda_pending"], bump)]
    pub nvda_pending_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Authority: update the creator payout destination (mut global_state).
#[derive(Accounts)]
pub struct SetCreatorPayout<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
}

/// Authority: update the pinned operator treasury (mut global_state).
#[derive(Accounts)]
pub struct SetTreasury<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
}

/// Authority: withdraw pending-NVDAx lamports for off-program conversion.
/// The destination is the operator's swap-funding wallet; the NVDAx proceeds
/// must come back via fund_spl_rewards.
#[derive(Accounts)]
pub struct WithdrawPendingNvdax<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    /// CHECK: PDA address verified via seeds/bump; source of the transfer.
    #[account(mut, seeds = [b"nvda_pending"], bump = global_state.nvda_pending_vault_bump)]
    pub nvda_pending_vault: UncheckedAccount<'info>,
    /// CHECK: swap funding destination — validated only as a non-zero,
    /// authority-chosen target; the conversion itself happens off-program.
    #[account(mut, constraint = swap_destination.key() != nvda_pending_vault.key() @ SolflowError::BadAccountLayout)]
    pub swap_destination: UncheckedAccount<'info>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(init, payer = user, space = 57, seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    #[account(init, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_SOL], bump)]
    pub sol_debt: Account<'info, UserAssetDebt>,
    #[account(init, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_NVDAX], bump)]
    pub nvda_debt: Account<'info, UserAssetDebt>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
}

/// Generic authority + one program-owned RewardAsset (any asset key).
#[derive(Accounts)]
pub struct AuthorityWithAsset<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    /// CHECK: verified program-owned RewardAsset in the instruction body.
    #[account(mut)]
    pub reward_asset: UncheckedAccount<'info>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AuthorityWithFeeSource<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    /// CHECK: verified program-owned FeeSourceConfig in the instruction body.
    #[account(mut)]
    pub fee_source_config: UncheckedAccount<'info>,
    #[account(constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitSolAsset<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(init, payer = authority, space = 164, seeds = [b"asset", ASSET_SOL], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    #[account(mut, seeds = [b"sol_vault"], bump = global_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitSplAsset<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(init, payer = authority, space = 164, seeds = [b"asset", ASSET_NVDAX], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    /// CHECK: NVDAx mint, validated in the instruction body (owner + layout).
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,
    /// SPL reward vault (PDA, funded + created in the instruction body).
    /// CHECK: created + initialized in the instruction body via CPIs.
    #[account(mut, seeds = [b"spl_vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: vault_auth PDA (seeds verified above); owns the SPL vault and
    /// signs its reward payouts. Holds no lamports or tokens itself.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitFeeSource<'info> {
    #[account(init, payer = authority, space = 42, seeds = [b"feesource", source.key().as_ref()], bump)]
    pub fee_source_config: Account<'info, FeeSourceConfig>,
    /// CHECK: whitelisted creator-fee source wallet.
    pub source: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    /// The $FLOW staking token mint — must match the registered staking mint.
    #[account(constraint = staking_mint.key() == global_state.staking_mint @ SolflowError::MintMismatch)]
    pub staking_mint: InterfaceAccount<'info, token_interface::Mint>,
    /// Program staking vault: PDA `flow_vault` seeded with the staking mint,
    /// owned by the vault_auth PDA. Holds ONLY the staked $FLOW.
    #[account(
        mut,
        seeds = [b"flow_vault", staking_mint.key().as_ref()],
        bump = global_state.staking_vault_bump,
        constraint = staking_vault.mint == staking_mint.key() @ SolflowError::MintMismatch,
        constraint = staking_vault.owner == vault_authority.key() @ SolflowError::BadAccountLayout
    )]
    pub staking_vault: InterfaceAccount<'info, token_interface::TokenAccount>,
    /// The staker's $FLOW token account (SOL can never be staked through it —
    /// the mint constraint pins this account to the FLOW mint).
    #[account(
        mut,
        constraint = user_flow_ata.mint == staking_mint.key() @ SolflowError::MintMismatch,
        constraint = user_flow_ata.owner == user.key() @ SolflowError::Unauthorized
    )]
    pub user_flow_ata: InterfaceAccount<'info, token_interface::TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: vault_auth PDA (seeds verified); owner of the staking vault.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, token_interface::TokenInterface>,
    // remaining_accounts: pairs of (reward_asset, user_asset_debt), PDA-verified
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    /// The $FLOW staking token mint — must match the registered staking mint.
    #[account(constraint = staking_mint.key() == global_state.staking_mint @ SolflowError::MintMismatch)]
    pub staking_mint: InterfaceAccount<'info, token_interface::Mint>,
    /// Program staking vault holding the staked $FLOW (returned to the user).
    #[account(
        mut,
        seeds = [b"flow_vault", staking_mint.key().as_ref()],
        bump = global_state.staking_vault_bump,
        constraint = staking_vault.mint == staking_mint.key() @ SolflowError::MintMismatch,
        constraint = staking_vault.owner == vault_authority.key() @ SolflowError::BadAccountLayout
    )]
    pub staking_vault: InterfaceAccount<'info, token_interface::TokenAccount>,
    #[account(
        mut,
        constraint = user_flow_ata.mint == staking_mint.key() @ SolflowError::MintMismatch,
        constraint = user_flow_ata.owner == user.key() @ SolflowError::Unauthorized
    )]
    pub user_flow_ata: InterfaceAccount<'info, token_interface::TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: vault_auth PDA (seeds verified); signs the payout CPI.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, token_interface::TokenInterface>,
    // remaining_accounts: pairs of (reward_asset, user_asset_debt), PDA-verified
}

#[derive(Accounts)]
pub struct InitFlowStaking<'info> {
    #[account(mut, seeds = [b"global"], bump, constraint = global_state.authority == authority.key() @ SolflowError::Unauthorized)]
    pub global_state: Account<'info, GlobalState>,
    /// The $FLOW staking token mint. Validated in the instruction body:
    /// owner must be the SPL Token program and data length 82 (Mint layout).
    /// CHECK: validated in the instruction body (owner + data length).
    #[account(mut)]
    pub staking_mint: UncheckedAccount<'info>,
    /// Staking vault token account (PDA, funded + created in the instruction
    /// body via system create_account, owned by the token program, authority
    /// = vault_auth).
    /// CHECK: created + initialized in the instruction body via CPIs.
    #[account(mut, seeds = [b"flow_vault", staking_mint.key().as_ref()], bump)]
    pub staking_vault: UncheckedAccount<'info>,
    /// CHECK: vault_auth PDA (seeds verified); authority of the staking vault.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, token_interface::TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundSol<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"asset", ASSET_SOL], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    #[account(mut, seeds = [b"sol_vault"], bump = global_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundSpl<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"asset", ASSET_NVDAX], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    #[account(mut, constraint = vault.mint == reward_asset.mint @ SolflowError::MintMismatch)]
    pub vault: InterfaceAccount<'info, token_interface::TokenAccount>,
    #[account(mut, constraint = funder_ata.mint == reward_asset.mint @ SolflowError::MintMismatch)]
    pub funder_ata: InterfaceAccount<'info, token_interface::TokenAccount>,
    /// CHECK: vault_auth PDA (seeds verified above); owns the SPL reward vault.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = funder_ata.owner == funder.key() @ SolflowError::Unauthorized)]
    pub funder: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(amount_lamports: u64, signature: [u8; 64], slot: u64)]
pub struct RecordFee<'info> {
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, constraint = authority.key() == global_state.authority @ SolflowError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(constraint = *fee_source_config.owner == crate::ID @ SolflowError::BadAccountLayout)]
    pub fee_source_config: UncheckedAccount<'info>,
    /// REPLAY GUARD: PDA seeded by the fee signature; `init` fails when the
    /// same signature was already processed.
    #[account(init, payer = authority, space = 129, seeds = [b"fee_receipt", &signature[..32]], bump)]
    pub fee_receipt: Account<'info, FeeReceipt>,
    #[account(mut, seeds = [b"asset", ASSET_SOL], bump)]
    pub sol_asset: Account<'info, RewardAsset>,
    #[account(mut, seeds = [b"sol_vault"], bump = global_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    /// LEVEL 1 payout destination: receives the creator share (70% of the
    /// fee). Must equal GlobalState::creator_payout (enforced in the body).
    /// CHECK: validated against global_state.creator_payout in the body.
    #[account(mut)]
    pub creator_payout: UncheckedAccount<'info>,
    /// Pending-NVDAx vault: receives the NVDAx allocation (9% of the fee, as
    /// SOL) until a real conversion route runs. NEVER pays SOL claims.
    /// CHECK: PDA address verified via seeds/bump.
    #[account(mut, seeds = [b"nvda_pending"], bump = global_state.nvda_pending_vault_bump)]
    pub nvda_pending_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimSol<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"asset", ASSET_SOL], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    #[account(seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    #[account(init_if_needed, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_SOL], bump)]
    pub user_debt: Account<'info, UserAssetDebt>,
    #[account(mut, seeds = [b"sol_vault"], bump = global_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimNvdax<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [b"asset", ASSET_NVDAX], bump)]
    pub reward_asset: Account<'info, RewardAsset>,
    #[account(seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    #[account(init_if_needed, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_NVDAX], bump)]
    pub user_debt: Account<'info, UserAssetDebt>,
    #[account(mut, constraint = vault.key() == reward_asset.vault @ SolflowError::BadAccountLayout)]
    pub vault: InterfaceAccount<'info, token_interface::TokenAccount>,
    #[account(mut, constraint = user_ata.mint == reward_asset.mint @ SolflowError::MintMismatch)]
    pub user_ata: InterfaceAccount<'info, token_interface::TokenAccount>,
    /// CHECK: vault_auth PDA (seeds verified above); signs the vault payout.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = user_ata.owner == user.key() @ SolflowError::Unauthorized)]
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAll<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(seeds = [b"position", user.key().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    #[account(mut, seeds = [b"asset", ASSET_SOL], bump)]
    pub sol_asset: Account<'info, RewardAsset>,
    #[account(init_if_needed, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_SOL], bump)]
    pub sol_debt: Account<'info, UserAssetDebt>,
    #[account(mut, seeds = [b"asset", ASSET_NVDAX], bump)]
    pub nvda_asset: Account<'info, RewardAsset>,
    #[account(init_if_needed, payer = user, space = 121, seeds = [b"debt", user.key().as_ref(), ASSET_NVDAX], bump)]
    pub nvda_debt: Account<'info, UserAssetDebt>,
    #[account(mut, seeds = [b"sol_vault"], bump = global_state.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, constraint = vault.key() == nvda_asset.vault @ SolflowError::BadAccountLayout)]
    pub vault: InterfaceAccount<'info, token_interface::TokenAccount>,
    /// CHECK: user's NVDAx token account; validated (mint + owner) in the
    /// instruction body only when the NVDAx asset is enabled.
    #[account(mut)]
    pub nvda_user_ata: UncheckedAccount<'info>,
    /// CHECK: vault_auth PDA (seeds verified above); signs the NVDAx payout.
    #[account(seeds = [b"vault_auth"], bump = global_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
