#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    Address, BytesN, Env,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_id = env.register(mock_game_hub::WASM, ());
    let game_id = env.register(PiratesTreasure, (&admin, &hub_id));

    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    (env, game_id, player_a, player_b, hub_id)
}

fn make_salt(env: &Env, seed: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[0] = seed;
    BytesN::from_array(env, &arr)
}

fn make_commitment(
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
    let hash = env.crypto().sha256(&buf);
    BytesN::from_array(env, &hash.to_array())
}

// Import the mock-game-hub WASM for test registration.
mod mock_game_hub {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/mock_game_hub.wasm"
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_create_room() {
    let (env, game_id, player_a, _player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    let room = client.create_room(&1u32, &player_a, &100_i128);
    assert_eq!(room.room_id, 1);
    assert_eq!(room.player_a, player_a);
    assert_eq!(room.phase, 0);
    assert_eq!(room.player_a_points, 100);
}

#[test]
fn test_join_room() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    let room = client.join_room(&1u32, &player_b, &200_i128);
    assert_eq!(room.player_b, player_b);
    assert_eq!(room.player_b_points, 200);
    assert_eq!(room.phase, 0); // still waiting for start
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_prevent_self_join() {
    let (env, game_id, player_a, _player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_a, &100_i128); // SelfPlay
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_prevent_double_join() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);
    let player_c = Address::generate(&env);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.join_room(&1u32, &player_c, &100_i128); // RoomFull
}

#[test]
fn test_start_room() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &200_i128);
    let room = client.start_room(&1u32, &player_a, &player_b, &100_i128, &200_i128);

    assert_eq!(room.phase, 1); // Burying
    assert!(room.game_active);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_start_without_opponent() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    // No join call — player_b placeholder == player_a
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);
}

#[test]
fn test_bury_treasure() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);
    let room = client.get_room(&1u32);
    assert!(room.has_commitment_a);
    assert!(!room.has_commitment_b);
    assert_eq!(room.phase, 1); // still burying

    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);
    let room = client.get_room(&1u32);
    assert!(room.has_commitment_a);
    assert!(room.has_commitment_b);
    assert_eq!(room.phase, 2); // auto-advanced to Playing
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_double_bury() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt = make_salt(&env, 1);
    let commit = make_commitment(&env, 1, 0, 5, &salt);
    client.bury_treasure(&1u32, &player_a, &commit);
    client.bury_treasure(&1u32, &player_a, &commit); // AlreadyBuried
}

#[test]
fn test_dig_alternating_turns() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    // Bury for both
    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);

    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    // Phase 2 — Player A digs first
    let room = client.get_room(&1u32);
    assert!(room.turn_is_a);

    client.dig(&1u32, &player_a, &0u32, &0u32);
    let room = client.get_room(&1u32);
    assert!(!room.turn_is_a);

    client.dig(&1u32, &player_b, &1u32, &3u32);
    let room = client.get_room(&1u32);
    assert!(room.turn_is_a);
    assert_eq!(room.digs.len(), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_dig_wrong_turn() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);
    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    // Player B tries to dig first — not their turn
    client.dig(&1u32, &player_b, &0u32, &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_dig_duplicate_tile() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);
    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    client.dig(&1u32, &player_a, &0u32, &0u32);
    client.dig(&1u32, &player_b, &0u32, &0u32); // AlreadyDug (same tile)
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_dig_invalid_island() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);
    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    client.dig(&1u32, &player_a, &5u32, &0u32); // InvalidIsland
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_dig_invalid_tile() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);
    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    client.dig(&1u32, &player_a, &0u32, &99u32); // InvalidTile (island 0 has 10 tiles)
}

#[test]
fn test_reveal_treasure_correct() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    // A buries at island=0, tile=5
    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);

    // B buries at island=2, tile=15
    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    // Player A reveals Player B's treasure (correctly)
    client.reveal_treasure(&1u32, &player_a, &2u32, &15u32, &salt_b);

    let room = client.get_room(&1u32);
    assert_eq!(room.phase, 3);
    assert!(!room.game_active);
    assert_eq!(room.winner, player_a);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_reveal_treasure_wrong() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);

    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    // Wrong island — commitment mismatch
    client.reveal_treasure(&1u32, &player_a, &0u32, &15u32, &salt_b);
}

#[test]
fn test_player_b_wins() {
    let (env, game_id, player_a, player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.join_room(&1u32, &player_b, &100_i128);
    client.start_room(&1u32, &player_a, &player_b, &100_i128, &100_i128);

    let salt_a = make_salt(&env, 1);
    let commit_a = make_commitment(&env, 1, 0, 5, &salt_a);
    client.bury_treasure(&1u32, &player_a, &commit_a);

    let salt_b = make_salt(&env, 2);
    let commit_b = make_commitment(&env, 1, 2, 15, &salt_b);
    client.bury_treasure(&1u32, &player_b, &commit_b);

    // A digs (wastes turn)
    client.dig(&1u32, &player_a, &1u32, &0u32);

    // Now it's B's turn — B reveals A's treasure
    client.reveal_treasure(&1u32, &player_b, &0u32, &5u32, &salt_a);

    let room = client.get_room(&1u32);
    assert_eq!(room.phase, 3);
    assert_eq!(room.winner, player_b);
}

#[test]
fn test_get_game_alias() {
    let (env, game_id, player_a, _player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    let room = client.get_game(&1u32);
    assert_eq!(room.room_id, 1);
}

#[test]
fn test_rooms_are_isolated() {
    let (env, game_id, player_a, _player_b, _hub) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    client.create_room(&1u32, &player_a, &100_i128);
    client.create_room(&2u32, &player_a, &500_i128);

    let room1 = client.get_room(&1u32);
    let room2 = client.get_room(&2u32);
    assert_eq!(room1.player_a_points, 100);
    assert_eq!(room2.player_a_points, 500);
}

#[test]
fn test_admin_functions() {
    let (env, game_id, _player_a, _player_b, hub_id) = setup_env();
    let client = PiratesTreasureClient::new(&env, &game_id);

    let _admin = client.get_admin();
    let hub = client.get_hub();
    assert_eq!(hub, hub_id);

    let new_admin = Address::generate(&env);
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);

    let new_hub = Address::generate(&env);
    client.set_hub(&new_hub);
    assert_eq!(client.get_hub(), new_hub);
}
