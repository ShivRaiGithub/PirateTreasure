/**
 * Crypto Utilities for Pirate's Treasure
 * 
 * This module handles:
 * - SHA-256 commitment generation (matching the Soroban contract)
 * - Client-side address hashing for discovery checks
 * - Secure salt generation and hex conversions
 * - In-memory treasure location storage (never persisted or sent to chain)
 * 
 * The on-chain commitment scheme uses SHA-256 via env.crypto().sha256.
 * All commitments are generated here and verified by the Soroban contract.
 */

// ============================================================================
// SHA-256 Commitment Generation
// ============================================================================

/**
 * Generate a SHA-256 commitment for treasure burial.
 * This MUST match the contract's compute_commitment exactly:
 * 
 *   SHA-256( room_id (4 BE bytes) ‖ island_id (4 BE bytes) ‖ tile_id (4 BE bytes) ‖ salt (32 bytes) )
 * 
 * @param roomId - Room identifier
 * @param islandId - Island index (0-2)
 * @param tileId - Tile index (0-29)
 * @param _ownerHash - Unused (kept for interface compatibility)
 * @param salt - Random salt (hex string, 32 bytes)
 * @returns The commitment as a hex string (32 bytes)
 */
export async function generateCommitment(
  roomId: number,
  islandId: number,
  tileId: number,
  _ownerHash: string,  // kept for interface compat but not used in on-chain scheme
  salt: string,        // 64-char hex = 32 bytes
): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Browser-only crypto');
  }
  // Must match the contract's compute_commitment:
  //   SHA-256( room_id (4 BE bytes) ‖ island_id (4 BE bytes) ‖ tile_id (4 BE bytes) ‖ salt (32 bytes) )
  const buf = new Uint8Array(4 + 4 + 4 + 32);
  const view = new DataView(buf.buffer as ArrayBuffer);
  view.setUint32(0, roomId, false);    // big-endian
  view.setUint32(4, islandId, false);
  view.setUint32(8, tileId, false);
  const saltBytes = hexToBytes(salt);
  buf.set(saltBytes, 12);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Generate a random 32-byte salt for treasure commitment.
 * Uses browser's crypto.getRandomValues for cryptographic randomness.
 * 
 * @returns Hex-encoded 32-byte salt
 */
export function generateSalt(): string {
  if (typeof window === 'undefined') {
    throw new Error('Browser-only crypto');
  }
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

/**
 * Hash a Stellar address for client-side treasure discovery checks.
 * Used by the frontend to compare dig results — NOT used on-chain.
 * 
 * Note: Uses SHA-256 internally (via the keccak256 shim below).
 * 
 * @param address - Stellar public key (G... format)
 * @returns Hex-encoded 32-byte hash
 */
export async function addressToFieldHash(address: string): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Browser-only crypto');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(address);
  const hash = await keccak256(data);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Treasure location data (private to the player)
 */
export interface TreasureLocation {
  roomId: number;
  islandId: number;
  tileId: number;
  ownerAddress: string;
  salt: string;
  commitment: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * SHA-256 hash wrapper used for client-side address hashing.
 * Named keccak256 for historical reasons; actually uses SHA-256.
 * This is only used for client-side discovery comparisons (addressToFieldHash),
 * NOT for on-chain commitments (which use generateCommitment above).
 */
async function keccak256(data: Uint8Array): Promise<ArrayBuffer> {
  if (typeof window === 'undefined') {
    throw new Error('Browser-only crypto');
  }
  return crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
}

/**
 * Store treasure location securely in browser memory.
 * This data is NEVER sent to any server or stored on-chain.
 * Only the commitment (hash) is stored on-chain.
 */
export class TreasureVault {
  private locations: Map<string, TreasureLocation> = new Map();

  /**
   * Store a treasure location for a specific room
   * @param roomId - Room identifier
   * @param location - The treasure location data
   */
  store(roomId: number, location: TreasureLocation): void {
    // Store under a player-specific key so two players in the same browser
    // don't overwrite each other's data.
    this.locations.set(`room-${roomId}-${location.ownerAddress}`, location);
  }

  /**
   * Retrieve a treasure location by owner address (use for reveals).
   */
  getByOwner(roomId: number, ownerAddress: string): TreasureLocation | null {
    return this.locations.get(`room-${roomId}-${ownerAddress}`) ?? null;
  }

  /**
   * @deprecated Use getByOwner instead.
   */
  get(roomId: number): TreasureLocation | null {
    return null;
  }

  /**
   * Remove treasure location data after game ends
   * @param roomId - Room identifier
   */
  clear(roomId: number): void {
    this.locations.delete(`room-${roomId}`);
  }
}

// Global treasure vault instance (browser memory only, never persisted)
export const treasureVault = new TreasureVault();
