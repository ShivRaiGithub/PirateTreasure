# Pirate's Treasure — Soroban Game Contract# My Game Game




























```bun run deploy my-gamebun run build my-game```bash## Build & DeployAll room state uses **temporary storage** with a 30-day TTL, extended on every write.## Storage- `reveal_treasure` (on success) calls `GameHub::end_game` to settle the winner.- `start_room` calls `GameHub::start_game` to lock points.## Game Hub Integration6. **Reveal Treasure** — When a player believes they've found the opponent's treasure, they submit the pre-image (island, tile, salt) that matches the opponent's commitment. The contract verifies the hash. If correct, that player wins.5. **Dig (Turn-Based)** — Players alternate turns digging tiles on 3 islands. Each dig is recorded on-chain.4. **Bury Treasure** — Each player secretly picks an island + tile and submits a cryptographic commitment (hash of island, tile, salt). Neither player can see the other's choice.3. **Start Room** — Both players co-sign a multi-sig `start_room` call, which registers the session with the Game Hub.2. **Join Room** — Player B joins and stakes their own points.1. **Create Room** — Player A creates a room with a points wager.## How It WorksA 2-player, turn-based treasure hunt game for Stellar.
A simple two-player guessing game smart contract built on Stellar's Soroban platform.

## Overview

Players compete by guessing a number between 1 and 10. The player whose guess is closest to the randomly generated number wins.

## Features

- **Random Number Generation**: Uses Soroban's PRNG to generate fair random numbers
- **Two-Player Games**: Each game involves exactly two players
- **Simple Rules**: Guess a number 1-10, closest guess wins
- **Multiple Concurrent Games**: Support for multiple independent games running simultaneously
- **Event Emissions**: All game actions emit events for tracking

## Contract Methods

### `start_game`
Start a new game between two players.

**Parameters:**
- `player1: Address` - First player's address
- `player2: Address` - Second player's address

**Returns:** `u32` - The game ID

**Auth:** Requires authentication from both players

### `make_guess`
Make a guess for a game.

**Parameters:**
- `game_id: u32` - The ID of the game
- `player: Address` - Address of the player making the guess
- `guess: u32` - The guessed number (must be 1-10)

**Returns:** `Result<(), Error>`

**Auth:** Requires authentication from the guessing player

### `reveal_winner`
Reveal the winner after both players have guessed.

**Parameters:**
- `game_id: u32` - The ID of the game

**Returns:** `Result<Address, Error>` - Address of the winning player

**Note:** Can only be called after both players have made their guesses. If both players are equidistant from the winning number, player1 wins.

### `get_game`
Get the current state of a game.

**Parameters:**
- `game_id: u32` - The ID of the game

**Returns:** `Result<Game, Error>` - The game state

## Game Flow

1. Two players call `start_game` to create a new game
2. A random number between 1-10 is generated using PRNG
3. Each player calls `make_guess` with their guess (1-10)
4. Once both players have guessed, anyone can call `reveal_winner`
5. The winner is determined by who guessed closest to the random number
6. The game is marked as ended and the winner is recorded

## Events

- **GameStartedEvent**: Emitted when a new game begins
  - `game_id: u32`
  - `player1: Address`
  - `player2: Address`

- **GuessMadeEvent**: Emitted when a player makes a guess
  - `game_id: u32`
  - `player: Address`
  - `guess: u32`

- **WinnerRevealedEvent**: Emitted when the winner is revealed
  - `game_id: u32`
  - `winner: Address`
  - `winning_number: u32`

## Error Codes

- `GameNotFound` (1): The specified game ID doesn't exist
- `GameAlreadyStarted` (2): Game has already been started
- `NotPlayer` (3): Caller is not a player in this game
- `AlreadyGuessed` (4): Player has already made their guess
- `BothPlayersNotGuessed` (5): Cannot reveal winner until both players guess
- `GameAlreadyEnded` (6): Game has already ended

## Building

```bash
stellar contract build
```

Output: `target/wasm32v1-none/release/number_guess.wasm`

## Testing

```bash
cargo test
```

## Example Usage

```rust
use soroban_sdk::{Address, Env};

// Create game
let game_id = contract.start_game(&player1, &player2);

// Players make guesses
contract.make_guess(&game_id, &player1, &5);
contract.make_guess(&game_id, &player2, &7);

// Reveal winner
let winner = contract.reveal_winner(&game_id);
```

## Technical Details

- **PRNG Warning**: The contract uses Soroban's PRNG which is unsuitable for generating secrets or high-stakes applications. It's perfectly fine for game mechanics where the random number is revealed immediately after use.
- **Storage**: Uses persistent storage for game state
- **Gas Optimization**: Minimal storage footprint per game
