# Pirate's Treasure

A 2-player hidden-information treasure hunt game built on Stellar with Soroban smart contracts. Each player secretly buries a treasure on one of three island maps using a cryptographic commitment. Players then take turns digging tiles, racing to uncover their opponent's hidden location. When a player finds the opponent's treasure, they submit a cryptographic reveal on-chain — the contract verifies the commitment and declares the winner, all without any trusted server. Fairness is enforced entirely by the contract.

Built on [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/) — a toolkit for shipping on-chain two-player games quickly on Stellar.

NOTE: You can play the game on the deployed site. However, since 2 particular wallets are being used, if someone else starts the game on their browser, then your ongoing match in your browser might stop working.

---

## Gameplay Overview

Pirate's Treasure is a fair-by-design hidden-information game. Here is how it works:

1. **Bury your treasure** — Before digging begins, each player picks a secret island and tile. Instead of sending that location directly to the chain, the player sends a SHA-256 commitment — a hash of the location and a random salt. The actual location is never revealed at this stage.

2. **Dig turn by turn** — Players alternate digging tiles across three islands (10, 20, and 30 tiles respectively). Every dig is recorded on-chain.

3. **Claim victory** — When a player believes they have identified their opponent's treasure location, they submit the pre-image of the opponent's commitment (island, tile, and salt). The contract rehashes the values and checks them against the stored commitment. If they match, that player wins.

4. **No trust required** — The commitment scheme ensures neither player can lie about where they buried their treasure. The reveal only works if the submitted values produced the exact hash that was committed at the start. There is no server, no oracle, and no referee.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Soroban (Rust) on Stellar Testnet |
| Game Framework | Stellar Game Studio |
| Commitment Scheme | SHA-256 (protocol-native via `env.crypto().sha256`) — enforced on-chain |
| ZK Circuit (ready, not yet enforced) | Noir (`zk/treasure/`) — Poseidon2 commitment + Groth16/BN254 proof |
| Frontend | React + Vite + TypeScript |
| Wallets | Dev wallets (no browser extension required) |
| Bindings | Auto-generated TypeScript clients via Stellar CLI |

---

## Local Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Rust](https://rustup.rs/) with the `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli)

### ENV
Create .env file from .env.example and fill the required variables

### Install and run

```bash
# 1. Install dependencies
bun install

# 2. Build contracts, deploy to testnet, generate bindings, write .env
bun run setup

# 3. Start the dev frontend with wallet switching
bun run dev:game my-game
```

### What `bun run setup` does

- Builds all Soroban contracts to WASM
- Deploys `mock-game-hub` and `my-game` (Pirate's Treasure) to Stellar Testnet
- Generates TypeScript bindings from the deployed contract interfaces
- Creates a root `.env` file with two funded dev wallet keypairs and contract addresses
- Writes `deployment.json` with all deployed contract IDs

The `.env` file is never committed. It is regenerated each time you run `setup`.

---

## Dev Wallets

The project uses two pre-funded dev wallets for local testing. No browser extension or Freighter wallet is needed.

- **Player 1** and **Player 2** keypairs are written to `.env` during setup.
- The standalone frontend includes a wallet switcher so you can simulate both players in the same browser tab.
- Dev wallets are testnet-only and are funded automatically via Friendbot.
- Switch between players using the wallet toggle in the top-right of the UI.

---

## Smart Contract Overview

The Pirate's Treasure contract (`contracts/my-game/`) manages the full game lifecycle through four phases:

### Phases

| Phase | Name | Description |
|---|---|---|
| 0 | Waiting | Player A created the room; waiting for Player B to join |
| 1 | Burying | Both players submit their SHA-256 treasure commitments |
| 2 | Playing | Turn-based digging; winner can reveal at any time on their turn |
| 3 | Ended | Game over; winner recorded on-chain |

### Key contract methods

- **`create_room`** — Player A creates a room with a points wager. Room state is stored in temporary storage with a 30-day TTL.
- **`join_room`** — Player B joins and stakes their points.
- **`start_room`** — Both players co-sign to activate the game. This calls `GameHub::start_game` on the pinned hub contract (`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`) to register the session before any local state is written.
- **`bury_treasure`** — Each player submits a commitment: `SHA-256(room_id || island_id || tile_id || salt)`. The pre-image stays in the browser; only the hash hits the chain. Once both commitments are stored, the game automatically advances to the Playing phase.
- **`dig`** — The current player digs a tile on a chosen island. Every dig is appended to an on-chain `Vec<DigRecord>`. Turns alternate automatically.
- **`reveal_treasure`** — A player submits `(island_id, tile_id, salt)` for the **opponent's** commitment. The contract rehashes and compares. On match, it calls `GameHub::end_game` on the hub contract before writing the winner — ensuring the hub is always the authoritative record of the outcome.
- **`get_game`** — Read the full room state (available to the frontend at any time).

### Storage

All room and commitment data uses **temporary storage** with a 30-day TTL, extended on every write. Instance storage (admin, hub address) uses the same TTL pattern.

### ZK Circuit (ready — not yet enforced on-chain)

A Noir circuit lives in `zk/treasure/`. It mirrors the game's reveal logic and proves knowledge of a valid treasure location — `Poseidon2(room_id, island_id, tile_id, owner_hash, salt) == commitment` — without disclosing the secret. The circuit targets BN254/Groth16, includes range and ownership constraints, and passes its own Nargo test suite.

**Current status:** The on-chain game enforces commitments and reveals using SHA-256 (`env.crypto().sha256`). The Noir circuit is included to demonstrate how the system can evolve into full zero-knowledge verification once Stellar's BN254 host functions are available for on-chain proof verification. SNARK proof generation and on-chain verification are intentionally out-of-scope for this prototype; the circuit exists as a tested, architecturally compatible extension path.

---

## Project Structure

```
├── contracts/
│   ├── mock-game-hub/       # Required Game Hub contract (hackathon integration)
│   └── my-game/             # Pirate's Treasure Soroban contract
├── bindings/                # Auto-generated TypeScript clients (do not hand-edit)
├── my-game-frontend/        # Standalone React + Vite frontend
│   └── src/games/my-game/
│       ├── MyGameGame.tsx   # Main game UI component
│       ├── myGameService.ts # Contract interaction layer
│       ├── bindings.ts      # Generated contract bindings (copied from bindings/)
│       └── zkUtils.ts       # Commitment generation and ZK proof utilities
├── zk/
│   └── treasure/            # Noir ZK circuit for commitment proofs
├── scripts/                 # Bun scripts: setup, build, deploy, bindings, dev
├── deployment.json          # Deployed contract IDs and metadata
└── .env                     # Dev wallet keypairs and config (never committed)
```

---

## Commands

```bash
bun run setup                    # Build + deploy to testnet, generate bindings, write .env
bun run build my-game            # Build the Pirate's Treasure contract
bun run deploy my-game           # Deploy to testnet
bun run bindings my-game         # Regenerate TypeScript bindings
bun run dev:game my-game         # Run the standalone frontend with wallet switching
```

---

## Hackathon Context

Pirate's Treasure was built for the **ZK Gaming on Stellar** hackathon track. The game demonstrates:

### Enforced today

- **Protocol-level cryptography** — treasure commitments are created and verified using Stellar's native `env.crypto().sha256` directly in the Soroban contract. No external libraries or oracles are needed.
- **Fair hidden information** — the commit–reveal pattern enforces honest gameplay at the contract level. Neither player can change their treasure location after committing, and the contract rejects any reveal whose hash does not match the stored commitment.
- **Trustless winner determination** — the contract verifies the pre-image, calls `GameHub::end_game`, and records the winner on-chain before any local state is written. No server or referee is involved.
- **Fog-of-war** — the frontend only renders a player's own dig history. Opponent digs and treasure locations are never exposed to the client.
- **Stellar Game Hub integration** — lifecycle events (`start_game`, `end_game`) are reported to the shared hub contract as required by the hackathon framework. The deployment script hard-pins the official testnet hub address `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` and passes it to the contract constructor; every `start_room` and `reveal_treasure` call invokes that contract on-chain.

### ZK-ready architecture (circuit tested, not yet enforced on-chain)

- **Noir circuit** — `zk/treasure/` contains a complete Noir circuit that proves knowledge of a valid treasure location using Poseidon2, BN254, and Groth16. The circuit includes range checks, anti-self-reveal constraints, and a full Nargo test suite.
- **Designed for Stellar's ZK primitives** — the commitment scheme and proof format are compatible with Stellar's new cryptographic host functions (BN254 pairing, Poseidon2). Once on-chain proof verification is available, the existing SHA-256 reveal can be upgraded to require a SNARK proof with no changes to the game's architecture.
- **Intentional scope boundary** — full SNARK proof generation and on-chain verification are out-of-scope for this prototype. The circuit is included to show the clear upgrade path from trustless commit–reveal to full zero-knowledge verification.

---

## Links

- [Stellar Developers](https://developers.stellar.org/)
- [Soroban Docs](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)
- [Noir Language](https://noir-lang.org/)

## License

MIT License — see LICENSE file
