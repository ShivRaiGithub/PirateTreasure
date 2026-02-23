# Pirate's Treasure

A ZK-inspired 2-player treasure hunt game built on Stellar with Soroban smart contracts. Cryptographic commitments enforce hidden information directly on-chain — each player secretly buries a treasure on one of three island maps, and the contract guarantees that no one can lie, peek, or change their choice after the fact. Players take turns digging tiles, racing to uncover their opponent's hidden location. When a player finds it, they submit a cryptographic reveal on-chain — the contract independently verifies correctness and declares the winner, all without any trusted server or referee. Verifiable outcomes without trusted intermediaries.

Built on [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/) — a toolkit for shipping on-chain two-player games quickly on Stellar.

NOTE: You can play the game on the deployed site. However, since 2 particular wallets are being used, if someone else starts the game on their browser, then your ongoing match in your browser might stop working.

---

## Gameplay Overview

Pirate's Treasure is a fair-by-design hidden-information game that uses cryptography as a core gameplay primitive. Here is how it works:

1. **Bury your treasure** — Before digging begins, each player picks a secret island and tile. Instead of sending that location directly to the chain, the player sends a SHA-256 commitment — a hash of the location and a random salt. The actual location is never revealed at this stage.

2. **Dig turn by turn** — Players alternate digging tiles across three islands (10, 20, and 30 tiles respectively). Every dig is recorded on-chain.

3. **Claim victory** — When a player believes they have identified their opponent's treasure location, they submit the pre-image of the opponent's commitment (island, tile, and salt). The contract rehashes the values and checks them against the stored commitment. If they match, that player wins.

4. **No trust required** — The commitment scheme ensures neither player can lie about where they buried their treasure. The reveal only works if the submitted values produced the exact hash that was committed at the start. There is no server, no oracle, and no referee.

### Why this is ZK-inspired

The game achieves zero-knowledge–like gameplay properties using cryptographic commitments. Each player commits to a secret (their treasure location) without revealing it — the contract stores only the hash. Information is disclosed only at the moment of victory, when the winning player proves they know the opponent's secret by submitting values that reproduce the stored commitment. The contract independently verifies correctness; no player, server, or third party is trusted with hidden state at any point.

This is the same core principle behind zero-knowledge protocols: prove that something is true without revealing why it is true. The game applies that principle as a practical gameplay mechanic — privacy until reveal, commitment before action, and verifiable resolution — all enforced on-chain.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Soroban (Rust) on Stellar Testnet |
| Game Framework | Stellar Game Studio |
| Commitment Scheme | SHA-256 (protocol-native via `env.crypto().sha256`) — hidden-information enforced on-chain |
| Cryptographic Circuit (exploratory) | Noir (`zk/treasure/`) — Poseidon2 commitment circuit, future-looking |
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

### Cryptographic Circuit (exploratory)

A Noir circuit lives in `zk/treasure/`. It mirrors the game's reveal logic and proves knowledge of a valid treasure location — `Poseidon2(room_id, island_id, tile_id, owner_hash, salt) == commitment` — without disclosing the secret. The circuit includes range and ownership constraints and passes its own Nargo test suite.

**Current status:** The on-chain game enforces commitments and reveals using SHA-256 (`env.crypto().sha256`). The Noir circuit is included as a future-looking exploration of how the game's commit–reveal scheme could evolve into formal zero-knowledge proof verification. It is not part of live gameplay enforcement — it exists as a tested, standalone reference for the next iteration of the design.

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
│       └── zkUtils.ts       # SHA-256 commitment generation and crypto utilities
├── zk/
│   └── treasure/            # Exploratory Noir circuit (future-looking)
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

Pirate's Treasure was built for the **ZK Gaming on Stellar** hackathon track. The project demonstrates how cryptographic commitments can function as a ZK-style gameplay primitive — enforcing hidden information, fair play, and verifiable outcomes entirely on-chain, without a trusted server.

The focus is on **fairness, hidden state, and verifiable resolution**. Rather than implementing formal SNARK verification, the game uses Stellar's native cryptography to deliver the properties that matter most in ZK gaming: players commit to secrets they cannot change, information stays private until the moment of victory, and the contract independently determines the winner.

### Cryptographic hidden-information mechanics

- **Cryptographic commitments as gameplay** — treasure commitments are created and verified using Stellar's native `env.crypto().sha256` directly in the Soroban contract. Each player's secret is hidden behind a hash that only they can open. No external libraries or oracles are needed.
- **Hidden information enforced on-chain** — the commit–reveal pattern enforces honest gameplay at the contract level. Neither player can change their treasure location after committing, and the contract rejects any reveal whose hash does not match the stored commitment. This is the same privacy-until-reveal property that formal ZK protocols provide.
- **Verifiable outcomes without trusted intermediaries** — the contract verifies the pre-image, calls `GameHub::end_game`, and records the winner on-chain before any local state is written. No server, referee, or oracle is involved in determining the outcome.
- **Fog-of-war** — the frontend only renders a player's own dig history. Opponent digs and treasure locations are never exposed to the client.
- **Stellar Game Hub integration** — lifecycle events (`start_game`, `end_game`) are reported to the shared hub contract as required by the hackathon framework. The deployment script hard-pins the official testnet hub address `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` and passes it to the contract constructor; every `start_room` and `reveal_treasure` call invokes that contract on-chain.

### Exploratory circuit (future-looking)

- **Noir circuit** — `zk/treasure/` contains an exploratory Noir circuit that proves knowledge of a valid treasure location using Poseidon2. The circuit includes range checks, anti-self-reveal constraints, and a full Nargo test suite.
- **Not part of live gameplay** — the circuit is included as a tested reference showing how the game's commit–reveal scheme could evolve into formal zero-knowledge proof verification in a future iteration. It is not wired into the contract or frontend today.
- **Design direction** — the game's architecture is structured so that the SHA-256 reveal step could be augmented with a proof requirement as on-chain verification capabilities mature. The cryptographic gameplay properties are already in place.

---

## Links

- [Stellar Developers](https://developers.stellar.org/)
- [Soroban Docs](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)
- [Noir Language](https://noir-lang.org/)

## License

MIT License — see LICENSE file
