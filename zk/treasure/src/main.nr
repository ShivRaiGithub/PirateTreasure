// ============================================================================
// ZK Treasure Hunt Circuit
// ============================================================================
//
// This Noir circuit proves knowledge of a treasure's hidden location without
// revealing it. It is the core ZK mechanic of the Treasure Hunt game.
//
// The prover demonstrates:
//   1. Knowledge of (island_id, tile_id, salt) — the secret treasure location
//   2. That Poseidon2(room_id, island_id, tile_id, owner_hash, salt) == commitment
//   3. That the commitment belongs to the opponent (not the prover)
//   4. That island_id and tile_id are within valid ranges
//
// Public Inputs (visible on-chain):
//   - commitment: The Poseidon2 hash stored on-chain during treasure burial
//   - room_id: The room this proof pertains to
//   - owner_hash: keccak256-truncated hash of the treasure owner's address
//   - claimer_hash: keccak256-truncated hash of the player claiming the find
//   - island_id: The island being revealed (needed for on-chain validation)
//   - tile_id: The tile being revealed (needed for on-chain validation)
//
// Private Inputs (known only to prover, never on-chain):
//   - salt: Random nonce used when burying the treasure
//
// Commitment Scheme:
//   commitment = Poseidon2(room_id, island_id, tile_id, owner_hash, salt)
//
// The on-chain verifier checks:
//   - The proof is valid (BN254 pairing check)
//   - Public input `commitment` matches the stored on-chain commitment
//   - Public input `room_id` matches the actual room
//   - Public input `owner_hash` matches the opponent's address hash
//   - Public input `claimer_hash` matches the submitter's address hash
//   - island_id and tile_id are within the room's valid ranges
//
// Security Properties:
//   - Treasure location (island_id, tile_id) is hidden until reveal
//   - Salt prevents brute-force attacks on the commitment
//   - Owner/claimer separation prevents self-reveals
//   - Range checks prevent out-of-bounds claims

use std::hash::poseidon2::Poseidon2;

/// Main circuit: proves knowledge of a treasure location that matches
/// a publicly known commitment.
///
/// # Arguments
/// * `commitment` (public) - The Poseidon2 hash stored on-chain
/// * `room_id` (public) - Room identifier
/// * `owner_hash` (public) - Truncated hash of treasure owner's Stellar address
/// * `claimer_hash` (public) - Truncated hash of the claiming player's address
/// * `island_id` (public) - Island index (0-2), revealed during claim
/// * `tile_id` (public) - Tile index (0-29), revealed during claim
/// * `salt` (private) - Secret random nonce known only to the treasure hider
fn main(
    // Public inputs — these are verified on-chain
    commitment: pub Field,
    room_id: pub Field,
    owner_hash: pub Field,
    claimer_hash: pub Field,
    island_id: pub Field,
    tile_id: pub Field,
    // Private inputs — never revealed on-chain
    salt: Field,
) {
    // ========================================================================
    // 1. Range checks: island_id in [0, 2], tile_id in [0, 29]
    // ========================================================================
    // These constraints ensure the revealed location is within valid bounds.
    // The on-chain contract also validates these against room-specific tile counts.
    assert(island_id as u8 <= 2, "island_id must be 0, 1, or 2");
    assert(tile_id as u8 <= 29, "tile_id must be between 0 and 29");

    // ========================================================================
    // 2. Ownership check: claimer != owner (can't reveal your own treasure)
    // ========================================================================
    assert(claimer_hash != owner_hash, "Cannot reveal your own treasure");

    // ========================================================================
    // 3. Poseidon2 commitment verification
    // ========================================================================
    // Recompute the commitment from all inputs and verify it matches the public
    // commitment. This proves the prover knows the secret (salt) that was used
    // when the treasure was buried.
    //
    // The hash inputs are ordered: [room_id, island_id, tile_id, owner_hash, salt]
    // This must match exactly how the frontend computes the commitment.
    let computed_commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    assert(computed_commitment == commitment, "Commitment mismatch: proof does not match stored commitment");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_valid_proof() {
    // Simulate a valid treasure location proof
    let room_id: Field = 42;
    let island_id: Field = 1;
    let tile_id: Field = 15;
    let owner_hash: Field = 0x1234567890abcdef;
    let claimer_hash: Field = 0xfedcba0987654321;
    let salt: Field = 0xdeadbeefcafe1234;

    // Compute the commitment the same way
    let commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    // This should not panic
    main(commitment, room_id, owner_hash, claimer_hash, island_id, tile_id, salt);
}

#[test(should_fail_with = "Commitment mismatch")]
fn test_wrong_salt_fails() {
    let room_id: Field = 42;
    let island_id: Field = 1;
    let tile_id: Field = 15;
    let owner_hash: Field = 0x1234567890abcdef;
    let claimer_hash: Field = 0xfedcba0987654321;
    let salt: Field = 0xdeadbeefcafe1234;
    let wrong_salt: Field = 0xbadbadbadbadbad0;

    let commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    // Wrong salt should fail
    main(commitment, room_id, owner_hash, claimer_hash, island_id, tile_id, wrong_salt);
}

#[test(should_fail_with = "Cannot reveal your own treasure")]
fn test_self_reveal_fails() {
    let room_id: Field = 42;
    let island_id: Field = 1;
    let tile_id: Field = 15;
    let owner_hash: Field = 0x1234567890abcdef;
    let salt: Field = 0xdeadbeefcafe1234;

    let commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    // Claimer == Owner should fail
    main(commitment, room_id, owner_hash, owner_hash, island_id, tile_id, salt);
}

#[test(should_fail_with = "island_id must be 0, 1, or 2")]
fn test_invalid_island_fails() {
    let room_id: Field = 42;
    let island_id: Field = 5; // Invalid
    let tile_id: Field = 15;
    let owner_hash: Field = 0x1234567890abcdef;
    let claimer_hash: Field = 0xfedcba0987654321;
    let salt: Field = 0xdeadbeefcafe1234;

    let commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    main(commitment, room_id, owner_hash, claimer_hash, island_id, tile_id, salt);
}

#[test(should_fail_with = "tile_id must be between 0 and 29")]
fn test_invalid_tile_fails() {
    let room_id: Field = 42;
    let island_id: Field = 1;
    let tile_id: Field = 35; // Invalid
    let owner_hash: Field = 0x1234567890abcdef;
    let claimer_hash: Field = 0xfedcba0987654321;
    let salt: Field = 0xdeadbeefcafe1234;

    let commitment = Poseidon2::hash([room_id, island_id, tile_id, owner_hash, salt], 5);

    main(commitment, room_id, owner_hash, claimer_hash, island_id, tile_id, salt);
}
