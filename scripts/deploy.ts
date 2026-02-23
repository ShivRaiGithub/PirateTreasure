#!/usr/bin/env bun

/**
 * Deploy script for Soroban contracts to testnet
 *
 * Deploys Soroban contracts to testnet
 * Returns the deployed contract IDs
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readEnvFile, getEnvValue } from './utils/env';
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

type StellarKeypair = {
  publicKey(): string;
  secret(): string;
};

type StellarKeypairFactory = {
  random(): StellarKeypair;
  fromSecret(secret: string): StellarKeypair;
};

async function loadKeypairFactory(): Promise<StellarKeypairFactory> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  } catch (error) {
    console.warn("⚠️  @stellar/stellar-sdk is not installed. Running `bun install`...");
    try {
      await $`bun install`;
      const sdk = await import("@stellar/stellar-sdk");
      return sdk.Keypair;
    } catch (installError) {
      console.error("❌ Failed to load @stellar/stellar-sdk.");
      console.error("Run `bun install` in the repository root, then retry.");
      process.exit(1);
    }
  }
}

function usage() {
  console.log(`
Usage: bun run deploy [contract-name...]

Examples:
  bun run deploy
  bun run deploy my-game
`);
}

console.log("🚀 Deploying contracts to Stellar testnet...\n");
const Keypair = await loadKeypairFactory();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runWithRetry(
  fn: () => Promise<string>,
  retries = 3,
  delayMs = 10_000,
  retryOn = (err: unknown) => String(err).includes('TxNoAccount'),
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries - 1 && retryOn(err)) {
        console.log(`  ⏳ RPC not yet in sync (TxNoAccount), retrying in ${delayMs / 1000}s… (${attempt + 1}/${retries - 1})`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

const NETWORK = 'testnet';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const EXISTING_GAME_HUB_TESTNET_CONTRACT_ID = 'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG';

async function testnetAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`, { method: 'GET' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking ${address}`);
  return true;
}

async function ensureTestnetFunded(address: string): Promise<void> {
  if (await testnetAccountExists(address)) return;
  console.log(`💰 Funding ${address} via friendbot...`);
  const fundRes = await fetch(`https://friendbot.stellar.org?addr=${address}`, { method: 'GET' });
  if (!fundRes.ok) {
    throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await testnetAccountExists(address)) return;
  }
  throw new Error(`Funded ${address} but it still doesn't appear on Horizon after 30s`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const allContracts = await getWorkspaceContracts();
const selection = selectContracts(allContracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(allContracts)}`);
  process.exit(1);
}

const contracts = selection.contracts;
const mock = allContracts.find((c) => c.isMockHub);
if (!mock) {
  console.error("❌ Error: mock-game-hub contract not found in workspace members");
  process.exit(1);
}

// Check required WASM files exist for selected contracts (non-mock first)
const missingWasm: string[] = [];
for (const contract of contracts) {
  if (contract.isMockHub) continue;
  if (!await Bun.file(contract.wasmPath).exists()) missingWasm.push(contract.wasmPath);
}
if (missingWasm.length > 0) {
  console.error("❌ Error: Missing WASM build outputs:");
  for (const p of missingWasm) console.error(`  - ${p}`);
  console.error("\nRun 'bun run build [contract-name]' first");
  process.exit(1);
}

// Create three testnet identities: admin, player1, player2
// Admin signs deployments directly via secret key (no CLI identity required).
// Player1 and player2 are keypairs for frontend dev use.
const walletAddresses: Record<string, string> = {};
const walletSecrets: Record<string, string> = {};

// Load existing secrets from .env if available
let existingSecrets: Record<string, string | null> = {
  player1: null,
  player2: null,
};

const existingEnv = await readEnvFile('.env');
for (const identity of ['player1', 'player2']) {
  const key = `VITE_DEV_${identity.toUpperCase()}_SECRET`;
  const v = getEnvValue(existingEnv, key);
  if (v && v !== 'NOT_AVAILABLE') existingSecrets[identity] = v;
}

// Load existing deployment info so partial deploys can preserve other IDs.
const existingContractIds: Record<string, string> = {};
let existingDeployment: any = null;
if (existsSync("deployment.json")) {
  try {
    existingDeployment = await Bun.file("deployment.json").json();
    if (existingDeployment?.contracts && typeof existingDeployment.contracts === "object") {
      Object.assign(existingContractIds, existingDeployment.contracts);
    } else {
      // Backwards compatible fallback
      if (existingDeployment?.mockGameHubId) existingContractIds["mock-game-hub"] = existingDeployment.mockGameHubId;
    }
  } catch (error) {
    console.warn("⚠️  Warning: Failed to parse deployment.json, continuing...");
  }
}

for (const contract of allContracts) {
  if (existingContractIds[contract.packageName]) continue;
  const envId = getEnvValue(existingEnv, `VITE_${contract.envKey}_CONTRACT_ID`);
  if (envId) existingContractIds[contract.packageName] = envId;
}

// Handle admin identity (needs to be in Stellar CLI for deployment)
console.log('Setting up admin identity...');
const existingAdminSecret = getEnvValue(existingEnv, 'VITE_DEV_ADMIN_SECRET');

let adminKeypair: StellarKeypair;

if (existingAdminSecret && existingAdminSecret !== 'NOT_AVAILABLE') {
  console.log('✅ Using existing admin from .env');
  adminKeypair = Keypair.fromSecret(existingAdminSecret);
} else {
  console.log('📝 Generating new admin identity...');
  adminKeypair = Keypair.random();
}

walletAddresses.admin = adminKeypair.publicKey();
walletSecrets.admin = adminKeypair.secret();

try {
  await ensureTestnetFunded(walletAddresses.admin);
  console.log('✅ admin funded');
  // Extra wait so the Soroban RPC node (separate from Horizon) has time to
  // ingest the same ledger before we submit the upload transaction.
  console.log('⏳ Waiting for Soroban RPC to sync account (8s)…');
  await sleep(8000);
} catch (error) {
  console.error('❌ Failed to ensure admin is funded. Deployment cannot proceed.');
  process.exit(1);
}

// Handle player identities (don't need to be in CLI, just keypairs)
for (const identity of ['player1', 'player2']) {
  console.log(`Setting up ${identity}...`);

  let keypair: StellarKeypair;
  if (existingSecrets[identity]) {
    console.log(`✅ Using existing ${identity} from .env`);
    keypair = Keypair.fromSecret(existingSecrets[identity]!);
  } else {
    console.log(`📝 Generating new ${identity}...`);
    keypair = Keypair.random();
  }

  walletAddresses[identity] = keypair.publicKey();
  walletSecrets[identity] = keypair.secret();
  console.log(`✅ ${identity}: ${keypair.publicKey()}`);

  // Ensure player accounts exist on testnet (even if reusing keys from .env)
  try {
    await ensureTestnetFunded(keypair.publicKey());
    console.log(`✅ ${identity} funded\n`);
  } catch (error) {
    console.warn(`⚠️  Warning: Failed to ensure ${identity} is funded, continuing anyway...`);
  }
}

// Save to deployment.json and .env for setup script to use
console.log("🔐 Player secret keys will be saved to .env (gitignored)\n");

console.log("💼 Wallet addresses:");
console.log(`  Admin:   ${walletAddresses.admin}`);
console.log(`  Player1: ${walletAddresses.player1}`);
console.log(`  Player2: ${walletAddresses.player2}\n`);

// Use admin secret for contract deployment
const adminAddress = walletAddresses.admin;
const adminSecret = adminKeypair.secret();

const deployed: Record<string, string> = { ...existingContractIds };

// Always use the pinned testnet Game Hub — never upload, deploy, or upgrade it.
const mockGameHubId = EXISTING_GAME_HUB_TESTNET_CONTRACT_ID;
deployed[mock.packageName] = mockGameHubId;
console.log(`✅ Using pinned mock-game-hub on testnet: ${mockGameHubId}\n`);

for (const contract of contracts) {
  if (contract.isMockHub) continue;

  console.log(`Deploying ${contract.packageName}...`);
  console.log(`  Uploading and deploying ${contract.wasmPath}...`);
  try {
    const contractId = (await runWithRetry(() =>
      $`stellar contract deploy --wasm ${contract.wasmPath} --source-account ${adminSecret} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${mockGameHubId}`.text()
    )).trim();
    deployed[contract.packageName] = contractId;
    console.log(`✅ ${contract.packageName} deployed: ${contractId}\n`);
  } catch (error) {
    console.error(`❌ Failed to deploy ${contract.packageName}:`, error);
    process.exit(1);
  }
}

console.log("🎉 Deployment complete!\n");
console.log("Contract IDs:");
const outputContracts = new Set<string>();
for (const contract of contracts) outputContracts.add(contract.packageName);
outputContracts.add(mock.packageName); // always show pinned hub in output
for (const contract of allContracts) {
  if (!outputContracts.has(contract.packageName)) continue;
  const id = deployed[contract.packageName];
  if (id) console.log(`  ${contract.packageName}: ${id}`);
}

const deploymentContracts = allContracts.reduce<Record<string, string>>((acc, contract) => {
  acc[contract.packageName] = deployed[contract.packageName] || "";
  return acc;
}, {});

const deploymentInfo = {
  mockGameHubId,
  contracts: deploymentContracts,
  network: NETWORK,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  wallets: {
    admin: walletAddresses.admin,
    player1: walletAddresses.player1,
    player2: walletAddresses.player2,
  },
  deployedAt: new Date().toISOString(),
};

await Bun.write('deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
console.log("\n✅ Wrote deployment info to deployment.json");

const contractEnvLines = allContracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${deploymentContracts[c.packageName] || ""}`)
  .join("\n");

const envContent = `# Auto-generated by deploy script
# Do not edit manually - run 'bun run deploy' (or 'bun run setup') to regenerate
# WARNING: This file contains secret keys. Never commit to git!

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${walletAddresses.admin}
VITE_DEV_PLAYER1_ADDRESS=${walletAddresses.player1}
VITE_DEV_PLAYER2_ADDRESS=${walletAddresses.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_ADMIN_SECRET=${walletSecrets.admin}
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}
`;

await Bun.write('.env', envContent + '\n');
console.log("✅ Wrote secrets to .env (gitignored)");

export { mockGameHubId, deployed };
