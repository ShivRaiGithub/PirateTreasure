#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, contractclient,
    panic_with_error,
    Address, BytesN, Env, Vec,
    crypto::Hash,
};

// ---------------------------------------------------------------------------
// Game Hub client interface (calls into the hub contract)
// ---------------------------------------------------------------------------

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );
    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Room already exists
    RoomExists = 1,
    /// Room not found
    RoomNotFound = 2,
    /// Room is full (Player B already joined)
    RoomFull = 3,
    /// Cannot join your own room
    SelfPlay = 4,
    /// Wrong game phase for this action
    WrongPhase = 5,
    /// Not your turn
    NotYourTurn = 6,
    /// Tile already dug
    AlreadyDug = 7,
    /// Commitment already submitted
    AlreadyBuried = 8,
    /// Invalid island index
    InvalidIsland = 9,
    /// Invalid tile index
    InvalidTile = 10,
    /// Commitment mismatch — the reveal does not match the buried commitment
    CommitmentMismatch = 11,
    /// Caller is not a player in this room
    NotAPlayer = 12,
    /// Game already ended
    GameEnded = 13,
    /// Player B has not joined yet
    NoOpponent = 14,
    /// Unauthorized caller
    Unauthorized = 15,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A record of a single dig action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DigRecord {
    pub digger: Address,
    pub island_id: u32,
    pub tile_id: u32,
}

/// Full room state.
///
/// `phase` values:
///   0 = Waiting (created, waiting for Player B or start)
///   1 = Burying  (both players submit commitments)
///   2 = Playing  (turn-based digging)
///   3 = Ended
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Room {
    pub room_id: u32,
    pub player_a: Address,
    pub player_b: Address,          // set on join_room
    pub player_a_points: i128,
    pub player_b_points: i128,
    pub phase: u32,
    pub turn_is_a: bool,
    /// Number of tiles on each island (length = 3).
    pub island_tile_counts: Vec<u32>,
    /// Whether Player A has submitted their commitment.
    pub has_commitment_a: bool,
    /// Whether Player B has submitted their commitment.
    pub has_commitment_b: bool,
    pub game_active: bool,
    pub winner: Address,             // zero-address until decided
    pub digs: Vec<DigRecord>,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Room(room_id) → Room
    Room(u32),
    /// Commitment(room_id, is_player_a) → BytesN<32>
    Commitment(u32, bool),
    /// Admin address
    Admin,
    /// Game Hub contract address
    GameHubAddress,
}

// ---------------------------------------------------------------------------
// TTL helpers (30-day temporary storage)
// ---------------------------------------------------------------------------

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_BUMP: u32 = 30 * DAY_IN_LEDGERS;        // 518 400
const TTL_THRESHOLD: u32 = TTL_BUMP - DAY_IN_LEDGERS; // 501 120

fn bump_temp(env: &Env, key: &DataKey) {
    env.storage()
        .temporary()
        .extend_ttl(key, TTL_THRESHOLD, TTL_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct PiratesTreasure;

#[contractimpl]
impl PiratesTreasure {
    // ── Constructor ────────────────────────────────────────────────────
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GameHubAddress, &game_hub);
        bump_instance(&env);
    }

    // ── Admin helpers ──────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage().instance().get(&DataKey::GameHubAddress).unwrap()
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::GameHubAddress, &new_hub);
        bump_instance(&env);
    }

    // ── Room lifecycle ─────────────────────────────────────────────────

    /// Create a new room. Caller becomes Player A.
    pub fn create_room(
        env: Env,
        room_id: u32,
        player_a: Address,
        player_a_points: i128,
    ) -> Room {
        player_a.require_auth();

        let key = DataKey::Room(room_id);
        if env.storage().temporary().has(&key) {
            panic_with_error!(&env, Error::RoomExists);
        }

        // 3 islands with 10, 20, 30 tiles
        let mut tile_counts = Vec::new(&env);
        tile_counts.push_back(10u32);
        tile_counts.push_back(20u32);
        tile_counts.push_back(30u32);

        let room = Room {
            room_id,
            player_a: player_a.clone(),
            player_b: player_a.clone(),  // placeholder — overwritten on join
            player_a_points,
            player_b_points: 0,
            phase: 0,
            turn_is_a: true,
            island_tile_counts: tile_counts,
            has_commitment_a: false,
            has_commitment_b: false,
            game_active: false,
            winner: player_a.clone(),    // placeholder
            digs: Vec::new(&env),
        };

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
        room
    }

    /// Player B joins an existing room.
    pub fn join_room(
        env: Env,
        room_id: u32,
        player_b: Address,
        player_b_points: i128,
    ) -> Room {
        player_b.require_auth();

        let key = DataKey::Room(room_id);
        let mut room: Room = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound));

        if room.phase != 0 {
            panic_with_error!(&env, Error::WrongPhase);
        }
        // Room is "full" once someone other than player_a is stored.
        // We detect "no opponent yet" by checking player_b == player_a (the placeholder).
        if room.player_b != room.player_a {
            panic_with_error!(&env, Error::RoomFull);
        }
        if player_b == room.player_a {
            panic_with_error!(&env, Error::SelfPlay);
        }

        room.player_b = player_b;
        room.player_b_points = player_b_points;

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
        room
    }

    /// Both players co-sign to start. Calls Game Hub `start_game`.
    pub fn start_room(
        env: Env,
        room_id: u32,
        player_a: Address,
        player_b: Address,
        player_a_points: i128,
        player_b_points: i128,
    ) -> Room {
        // Both players must authorize the points they're putting up.
        player_a.require_auth();
        player_b.require_auth();

        let key = DataKey::Room(room_id);
        let mut room: Room = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound));

        if room.phase != 0 {
            panic_with_error!(&env, Error::WrongPhase);
        }
        if room.player_b == room.player_a {
            panic_with_error!(&env, Error::NoOpponent);
        }

        // Register with Game Hub BEFORE mutating local state.
        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let hub = GameHubClient::new(&env, &hub_addr);
        hub.start_game(
            &env.current_contract_address(),
            &room_id,
            &player_a,
            &player_b,
            &player_a_points,
            &player_b_points,
        );

        room.player_a_points = player_a_points;
        room.player_b_points = player_b_points;
        room.phase = 1; // → Burying
        room.game_active = true;

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
        bump_instance(&env);
        room
    }

    // ── Bury phase ─────────────────────────────────────────────────────

    /// Submit a commitment = SHA-256(room_id ‖ island_id ‖ tile_id ‖ salt).
    /// The pre-image is kept secret; only the hash is stored on-chain.
    pub fn bury_treasure(
        env: Env,
        room_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) {
        player.require_auth();

        let key = DataKey::Room(room_id);
        let mut room: Room = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound));

        if room.phase != 1 {
            panic_with_error!(&env, Error::WrongPhase);
        }

        let is_a = player == room.player_a;
        let is_b = player == room.player_b;
        if !is_a && !is_b {
            panic_with_error!(&env, Error::NotAPlayer);
        }

        if is_a && room.has_commitment_a {
            panic_with_error!(&env, Error::AlreadyBuried);
        }
        if is_b && room.has_commitment_b {
            panic_with_error!(&env, Error::AlreadyBuried);
        }

        // Store commitment separately (avoids nested Option issues).
        let commit_key = DataKey::Commitment(room_id, is_a);
        env.storage().temporary().set(&commit_key, &commitment);
        bump_temp(&env, &commit_key);

        if is_a {
            room.has_commitment_a = true;
        } else {
            room.has_commitment_b = true;
        }

        // Auto-advance to Playing once both commitments are in.
        if room.has_commitment_a && room.has_commitment_b {
            room.phase = 2;
            room.turn_is_a = true; // Player A digs first.
        }

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
    }

    // ── Dig phase ──────────────────────────────────────────────────────

    /// Dig a tile. Must be the caller's turn.
    pub fn dig(
        env: Env,
        room_id: u32,
        player: Address,
        island_id: u32,
        tile_id: u32,
    ) {
        player.require_auth();

        let key = DataKey::Room(room_id);
        let mut room: Room = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound));

        if room.phase != 2 {
            panic_with_error!(&env, Error::WrongPhase);
        }

        let is_a = player == room.player_a;
        let is_b = player == room.player_b;
        if !is_a && !is_b {
            panic_with_error!(&env, Error::NotAPlayer);
        }

        // Turn check.
        if (room.turn_is_a && !is_a) || (!room.turn_is_a && !is_b) {
            panic_with_error!(&env, Error::NotYourTurn);
        }

        // Validate island/tile.
        if island_id >= room.island_tile_counts.len() {
            panic_with_error!(&env, Error::InvalidIsland);
        }
        let max_tiles = room.island_tile_counts.get(island_id).unwrap();
        if tile_id >= max_tiles {
            panic_with_error!(&env, Error::InvalidTile);
        }

        // Check for duplicate digs.
        for d in room.digs.iter() {
            if d.island_id == island_id && d.tile_id == tile_id {
                panic_with_error!(&env, Error::AlreadyDug);
            }
        }

        room.digs.push_back(DigRecord {
            digger: player,
            island_id,
            tile_id,
        });

        // Alternate turns.
        room.turn_is_a = !room.turn_is_a;

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
    }

    // ── Reveal phase ───────────────────────────────────────────────────

    /// Reveal the OPPONENT's treasure to claim victory.
    ///
    /// The caller provides (island_id, tile_id, salt). The contract
    /// rehashes and checks against the **opponent's** stored commitment.
    /// If the hash matches, the caller wins.
    pub fn reveal_treasure(
        env: Env,
        room_id: u32,
        player: Address,
        island_id: u32,
        tile_id: u32,
        salt: BytesN<32>,
    ) {
        player.require_auth();

        let key = DataKey::Room(room_id);
        let mut room: Room = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound));

        if room.phase != 2 {
            panic_with_error!(&env, Error::WrongPhase);
        }
        if !room.game_active {
            panic_with_error!(&env, Error::GameEnded);
        }

        let is_a = player == room.player_a;
        let is_b = player == room.player_b;
        if !is_a && !is_b {
            panic_with_error!(&env, Error::NotAPlayer);
        }

        // Turn check — reveal counts as a turn action.
        if (room.turn_is_a && !is_a) || (!room.turn_is_a && !is_b) {
            panic_with_error!(&env, Error::NotYourTurn);
        }

        // Retrieve the OPPONENT's commitment.
        let opponent_is_a = !is_a;
        let commit_key = DataKey::Commitment(room_id, opponent_is_a);
        let stored_commitment: BytesN<32> = env
            .storage()
            .temporary()
            .get(&commit_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::CommitmentMismatch));

        // Rebuild the hash:  SHA-256( room_id ‖ island_id ‖ tile_id ‖ salt )
        let computed = Self::compute_commitment(&env, room_id, island_id, tile_id, &salt);

        if computed != stored_commitment {
            panic_with_error!(&env, Error::CommitmentMismatch);
        }

        // ── Winner decided ─────────────────────────────────────────────
        let player1_won = is_a; // true if Player A wins

        // Notify Game Hub BEFORE mutating local state.
        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let hub = GameHubClient::new(&env, &hub_addr);
        hub.end_game(&room_id, &player1_won);

        room.winner = player.clone();
        room.game_active = false;
        room.phase = 3;

        env.storage().temporary().set(&key, &room);
        bump_temp(&env, &key);
        bump_instance(&env);
    }

    // ── Read-only helpers ──────────────────────────────────────────────

    /// Read room state (returns the Room struct or panics).
    pub fn get_room(env: Env, room_id: u32) -> Room {
        let key = DataKey::Room(room_id);
        env.storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::RoomNotFound))
    }

    /// Alias used by the frontend service layer.
    pub fn get_game(env: Env, room_id: u32) -> Room {
        Self::get_room(env, room_id)
    }

    // ── Internal ───────────────────────────────────────────────────────

    /// Compute SHA-256(room_id ‖ island_id ‖ tile_id ‖ salt).
    fn compute_commitment(
        env: &Env,
        room_id: u32,
        island_id: u32,
        tile_id: u32,
        salt: &BytesN<32>,
    ) -> BytesN<32> {
        use soroban_sdk::Bytes;

        let mut buf = Bytes::new(env);
        buf.extend_from_array(&room_id.to_be_bytes());
        buf.extend_from_array(&island_id.to_be_bytes());
        buf.extend_from_array(&tile_id.to_be_bytes());
        buf.extend_from_slice(&salt.to_array());

        let hash: Hash<32> = env.crypto().sha256(&buf);
        BytesN::from_array(env, &hash.to_array())
    }

    // ── Upgrade (admin only) ───────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
