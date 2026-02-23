# Pirate's Treasure

A 2-player hidden-information treasure hunt game built on Stellar with Soroban smart contracts. Each player secretly buries a treasure on one of three island maps using a cryptographic commitment. Players then take turns digging tiles, racing to uncover their opponent's hidden location. When a player finds the opponent's treasure, they submit a cryptographic reveal on-chain — the contract verifies the commitment and declares the winner, all without any trusted server. Fairness is enforced entirely by the contract.

Built on [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/) — a toolkit for shipping on-chain two-player games quickly on Stellar.

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
| Commitment Scheme | SHA-256 (protocol-native via `env.crypto().sha256`) |
| ZK Circuit | Noir (`zk/treasure/`) — Poseidon2 commitment + Groth16 proof |
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

### ZK Circuit

A Noir circuit lives in `zk/treasure/`. It proves knowledge of a treasure's location — `Poseidon2(room_id, island_id, tile_id, owner_hash, salt) == commitment` — without disclosing the location itself. The circuit uses BN254 and is compiled for Groth16. This layer strengthens the cryptographic guarantees beyond the on-chain SHA-256 scheme.

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

- **Protocol-level cryptography** — commitments are verified using Stellar's native `env.crypto().sha256` — no external libraries or oracles needed.
- **Fair hidden information** — the commitment-reveal pattern enforces honest gameplay at the contract level. Neither player can change their treasure location after committing.
- **ZK-ready architecture** — the `zk/treasure/` Noir circuit extends the commitment scheme with full zero-knowledge proofs (Poseidon2 hash, Groth16, BN254), enabling provable reveals without disclosing the secret until the moment of victory.
- **Stellar Game Hub integration** — lifecycle events (`start_game`, `end_game`) are reported to the shared hub contract as required by the hackathon framework. The deployment script hard-pins the official testnet hub address `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` and passes it to the contract constructor; every `start_room` and `reveal_treasure` call invokes that contract on-chain.

---

## Links

- [Stellar Developers](https://developers.stellar.org/)
- [Soroban Docs](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)
- [Noir Language](https://noir-lang.org/)

## License

MIT License — see LICENSE file
