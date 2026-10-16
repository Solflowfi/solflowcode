// SOLFLOW devnet vault setup — derive + verify the program-controlled vault
// architecture on Solana DEVNET.
//
// Derivations mirror programs/solflow/lib.rs EXACTLY:
//   SOL vault        PDA seeds ["sol_vault"]                     (SystemAccount)
//   vault_auth       PDA seeds ["vault_auth"]                    (payout signer)
//   FLOW staking vlt PDA seeds ["flow_vault", <staking_mint>]    (SPL token acct)
//   NVDAx reward vlt PDA seeds ["spl_vault"]                     (SPL token acct)
//
// All four are program PDAs — the SOLFLOW program controls them. vault_auth
// owns the SPL vaults and signs their payouts; it holds no lamports/tokens.
//
// STATUS LABELS (honest on-chain verification):
//   program: NOT DEPLOYED (no Rust/anchor toolchain here). The provisional
//   devnet program keypair (.devnet/program.json) is the pre-deployment
//   derivation base — when the operator deploys with THIS keypair, every
//   derived address matches exactly. On-chain existence is checked via RPC
//   and reported truthfully (no fabricated "exists" states).
//
// Usage: node scripts/setup_devnet_vaults.mjs [--verify <flow_mint>]
// Prints public addresses only. NEVER prints private keys.
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DEVNET_DIR = path.join(ROOT, ".devnet");
const RPC = "https://api.devnet.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const RPCS = [
  // Project's own Alchemy DEVNET endpoint (devnet-only key usage) and the
  // public devnet RPC as fallback. NEVER mainnet.
  process.env.ALCHEMY_SOLANA_DEVNET_RPC_URL || "https://solana-devnet.g.alchemy.com/v2/" + (process.env.ALCHEMY_API_KEY || ""),
  "https://api.devnet.solana.com",
].filter((u) => u && !u.endsWith("/v2/"));

async function rpcWithTimeout(url, method, params, timeoutMs = 20000) {
  const res = await Promise.race([
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), timeoutMs)),
  ]);
  if (!res.ok) throw new Error("RPC HTTP " + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result;
}

async function rpcAny(method, params) {
  let lastErr = null;
  for (const url of RPCS) {
    try {
      return await rpcWithTimeout(url, method, params);
    } catch (e) {
      lastErr = e;
      console.log(`  (rpc fallback: ${method} failed on ${new URL(url).host}: ${e instanceof Error ? e.message : e})`);
    }
  }
  throw lastErr ?? new Error("All devnet RPC endpoints failed");
}

async function getAccountInfoRaw(address) {
  return rpcAny("getAccountInfo", [address, { encoding: "base64" }]);
}

function loadOrCreateKeypair(name) {
  const file = path.join(DEVNET_DIR, name);
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(raw)), existed: true, file };
  }
  const kp = Keypair.generate();
  // Standard solana-keypair JSON layout ([secret...32, pubkey...32]); the
  // file stays local under .devnet/ (gitignored). NEVER printed.
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return { keypair: kp, existed: false, file };
}

async function accountState(address, label) {
  let info = null;
  try {
    info = await getAccountInfoRaw(address);
  } catch (e) {
    console.log(`  ${label}: ${address} | on-chain check FAILED (${e instanceof Error ? e.message : e})`);
    return null;
  }
  if (!info) {
    console.log(`  ${label}: ${address} | on-chain: NOT CREATED YET (expected — created by program init)`);
    return null;
  }
  console.log(`  ${label}: ${address} | on-chain: EXISTS | owner: ${info.owner} | lamports: ${info.lamports} | executable: ${info.executable}`);
  return info;
}

async function main() {
  const args = process.argv.slice(2);
  const verifyMintIdx = args.indexOf("--verify");
  const flowMintArg = verifyMintIdx >= 0 ? args[verifyMintIdx + 1] : null;

  fs.mkdirSync(DEVNET_DIR, { recursive: true });

  // ---------- 1. devnet keypairs (pre-deployment derivation base) ----------
  const program = loadOrCreateKeypair("program.json");
  const authority = loadOrCreateKeypair("authority.json");
  const funder = loadOrCreateKeypair("funder.json");
  console.log("=== DEVNET KEYPAIRS (.devnet/ — pubkeys only) ===");
  console.log(`  program (provisional PROGRAM_ID): ${program.keypair.publicKey.toBase58()}${program.existed ? "" : " (generated)"}`);
  console.log(`  authority: ${authority.keypair.publicKey.toBase58()}${authority.existed ? "" : " (generated)"}`);
  console.log(`  funder:    ${funder.keypair.publicKey.toBase58()}${funder.existed ? "" : " (generated)"}`);

  const programId = program.keypair.publicKey;

  // ---------- 2. program-controlled vault PDAs ----------
  console.log("\n=== PROGRAM-CONTROLLED VAULT PDAs (devnet) ===");
  const [solVault, solVaultBump] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault")], programId);
  const [vaultAuth, vaultAuthBump] = PublicKey.findProgramAddressSync([Buffer.from("vault_auth")], programId);
  const [splVault, splVaultBump] = PublicKey.findProgramAddressSync([Buffer.from("spl_vault")], programId);
  console.log(`  SOL vault        (["sol_vault"]):  ${solVault.toBase58()}  bump=${solVaultBump}`);
  console.log(`  vault_auth       (["vault_auth"]): ${vaultAuth.toBase58()}  bump=${vaultAuthBump}`);
  console.log(`  NVDAx reward vlt (["spl_vault"]):  ${splVault.toBase58()}  bump=${splVaultBump}`);

  let flowStakingVault = null;
  if (flowMintArg) {
    const mint = new PublicKey(flowMintArg); // throws on malformed
    const [stakingVault, stakingBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("flow_vault"), mint.toBuffer()],
      programId
    );
    flowStakingVault = stakingVault.toBase58();
    console.log(`  FLOW staking vlt (["flow_vault", <FLOW mint>]): ${stakingVault.toBase58()}  bump=${stakingBump}`);
  } else {
    console.log("  FLOW staking vlt: pass --verify <flow_mint> to derive (seed includes the mint key)");
  }

  // ---------- 3. on-chain verification (devnet RPC) ----------
  console.log("\n=== ON-CHAIN VERIFICATION (devnet) ===");
  await accountState(programId.toBase58(), "program");
  await accountState(solVault.toBase58(), "SOL vault");
  await accountState(vaultAuth.toBase58(), "vault_auth");
  await accountState(splVault.toBase58(), "NVDAx reward vault");
  if (flowStakingVault) await accountState(flowStakingVault, "FLOW staking vault");

  if (flowMintArg) {
    let mintInfo = null;
    try {
      mintInfo = await getAccountInfoRaw(flowMintArg);
    } catch (e) {
      console.log(`  FLOW mint ${flowMintArg}: on-chain check FAILED (${e instanceof Error ? e.message : e})`);
    }
    if (!mintInfo) {
      console.log(`  FLOW mint ${flowMintArg}: NOT FOUND on devnet`);
    } else if (mintInfo.owner !== TOKEN_PROGRAM) {
      console.log(`  FLOW mint ${flowMintArg}: owner ${mintInfo.owner} — NOT an SPL Token mint`);
    } else {
      console.log(`  FLOW mint ${flowMintArg}: EXISTS | owner: SPL Token Program | verified devnet SPL mint`);
    }
  }

  // ---------- 4. funder balance (devnet airdrop source) ----------
  const bal = await rpcAny("getBalance", [funder.keypair.publicKey.toBase58()]);
  console.log(`  funder balance: ${Number(bal) / 1_000_000_000} SOL (devnet)`);

  // ---------- summary for .env.local ----------
  console.log("\n=== .env.local VALUES ===");
  console.log(`NEXT_PUBLIC_PROGRAM_ID=${programId.toBase58()}`);
  if (flowMintArg) console.log(`NEXT_PUBLIC_FLOW_MINT=${flowMintArg}`);
  console.log(`NEXT_PUBLIC_SOL_REWARD_VAULT=${solVault.toBase58()}`);
  console.log(`NEXT_PUBLIC_NVDA_REWARD_VAULT=${splVault.toBase58()}`);
}

main().catch((e) => {
  console.error("SETUP FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
