// Generated bindings — do not edit. Re-generate with: bun run bindings my-game

import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";

export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: import.meta.env.VITE_MY_GAME_CONTRACT_ID || "",
  },
} as const;

export type DataKey = {tag: "Room", values: readonly [u32]} | {tag: "Commitment", values: readonly [u32, boolean]} | {tag: "Admin", values: void} | {tag: "GameHubAddress", values: void};

/**
 * Full room state.
 *
 * `phase` values:
 * 0 = Waiting (created, waiting for Player B or start)
 * 1 = Burying  (both players submit commitments)
 * 2 = Playing  (turn-based digging)
 * 3 = Ended
 */
export interface Room {
  digs: Array<DigRecord>;
  game_active: boolean;
  has_commitment_a: boolean;
  has_commitment_b: boolean;
  island_tile_counts: Array<u32>;
  phase: u32;
  player_a: string;
  player_a_points: i128;
  player_b: string;
  player_b_points: i128;
  room_id: u32;
  turn_is_a: boolean;
  winner: string;
}

export const Errors = {
  1: {message:"RoomExists"},
  2: {message:"RoomNotFound"},
  3: {message:"RoomFull"},
  4: {message:"SelfPlay"},
  5: {message:"WrongPhase"},
  6: {message:"NotYourTurn"},
  7: {message:"AlreadyDug"},
  8: {message:"AlreadyBuried"},
  9: {message:"InvalidIsland"},
  10: {message:"InvalidTile"},
  11: {message:"CommitmentMismatch"},
  12: {message:"NotAPlayer"},
  13: {message:"GameEnded"},
  14: {message:"NoOpponent"},
  15: {message:"Unauthorized"},
};

/**
 * A record of a single dig action.
 */
export interface DigRecord {
  digger: string;
  island_id: u32;
  tile_id: u32;
}

export class Client extends ContractClient {
  static async deploy<T = Client>(
    {admin, game_hub}: {admin: string, game_hub: string},
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        wasmHash: Buffer | string;
        salt?: Buffer | Uint8Array;
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAALFGdWxsIHJvb20gc3RhdGUuCgpgcGhhc2VgIHZhbHVlczoKMCA9IFdhaXRpbmcgKGNyZWF0ZWQsIHdhaXRpbmcgZm9yIFBsYXllciBCIG9yIHN0YXJ0KQoxID0gQnVyeWluZyAgKGJvdGggcGxheWVycyBzdWJtaXQgY29tbWl0bWVudHMpCjIgPSBQbGF5aW5nICAodHVybi1iYXNlZCBkaWdnaW5nKQozID0gRW5kZWQAAAAAAAAAAAAABFJvb20AAAANAAAAAAAAAARkaWdzAAAD6gAAB9AAAAAJRGlnUmVjb3JkAAAAAAAAAAAAAAtnYW1lX2FjdGl2ZQAAAAABAAAAMFdoZXRoZXIgUGxheWVyIEEgaGFzIHN1Ym1pdHRlZCB0aGVpciBjb21taXRtZW50LgAAABBoYXNfY29tbWl0bWVudF9hAAAAAQAAADBXaGV0aGVyIFBsYXllciBCIGhhcyBzdWJtaXR0ZWQgdGhlaXIgY29tbWl0bWVudC4AAAAQaGFzX2NvbW1pdG1lbnRfYgAAAAEAAAAsTnVtYmVyIG9mIHRpbGVzIG9uIGVhY2ggaXNsYW5kIChsZW5ndGggPSAzKS4AAAASaXNsYW5kX3RpbGVfY291bnRzAAAAAAPqAAAABAAAAAAAAAAFcGhhc2UAAAAAAAAEAAAAAAAAAAhwbGF5ZXJfYQAAABMAAAAAAAAAD3BsYXllcl9hX3BvaW50cwAAAAALAAAAAAAAAAhwbGF5ZXJfYgAAABMAAAAAAAAAD3BsYXllcl9iX3BvaW50cwAAAAALAAAAAAAAAAdyb29tX2lkAAAAAAQAAAAAAAAACXR1cm5faXNfYQAAAAAAAAEAAAAAAAAABndpbm5lcgAAAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADwAAABNSb29tIGFscmVhZHkgZXhpc3RzAAAAAApSb29tRXhpc3RzAAAAAAABAAAADlJvb20gbm90IGZvdW5kAAAAAAAMUm9vbU5vdEZvdW5kAAAAAgAAACZSb29tIGlzIGZ1bGwgKFBsYXllciBCIGFscmVhZHkgam9pbmVkKQAAAAAACFJvb21GdWxsAAAAAwAAABlDYW5ub3Qgam9pbiB5b3VyIG93biByb29tAAAAAAAACFNlbGZQbGF5AAAABAAAACBXcm9uZyBnYW1lIHBoYXNlIGZvciB0aGlzIGFjdGlvbgAAAApXcm9uZ1BoYXNlAAAAAAAFAAAADU5vdCB5b3VyIHR1cm4AAAAAAAALTm90WW91clR1cm4AAAAABgAAABBUaWxlIGFscmVhZHkgZHVnAAAACkFscmVhZHlEdWcAAAAAAAcAAAAcQ29tbWl0bWVudCBhbHJlYWR5IHN1Ym1pdHRlZAAAAA1BbHJlYWR5QnVyaWVkAAAAAAAACAAAABRJbnZhbGlkIGlzbGFuZCBpbmRleAAAAA1JbnZhbGlkSXNsYW5kAAAAAAAACQAAABJJbnZhbGlkIHRpbGUgaW5kZXgAAAAAAAtJbnZhbGlkVGlsZQAAAAAKAAAAR0NvbW1pdG1lbnQgbWlzbWF0Y2gg4oCUIHRoZSByZXZlYWwgZG9lcyBub3QgbWF0Y2ggdGhlIGJ1cmllZCBjb21taXRtZW50AAAAABJDb21taXRtZW50TWlzbWF0Y2gAAAAAAAsAAAAjQ2FsbGVyIGlzIG5vdCBhIHBsYXllciBpbiB0aGlzIHJvb20AAAAACk5vdEFQbGF5ZXIAAAAAAAwAAAASR2FtZSBhbHJlYWR5IGVuZGVkAAAAAAAJR2FtZUVuZGVkAAAAAAAADQAAABtQbGF5ZXIgQiBoYXMgbm90IGpvaW5lZCB5ZXQAAAAACk5vT3Bwb25lbnQAAAAAAA4AAAATVW5hdXRob3JpemVkIGNhbGxlcgAAAAAMVW5hdXRob3JpemVkAAAADw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAWUm9vbShyb29tX2lkKSDihpIgUm9vbQAAAAAABFJvb20AAAABAAAABAAAAAEAAAAvQ29tbWl0bWVudChyb29tX2lkLCBpc19wbGF5ZXJfYSkg4oaSIEJ5dGVzTjwzMj4AAAAACkNvbW1pdG1lbnQAAAAAAAIAAAAEAAAAAQAAAAAAAAANQWRtaW4gYWRkcmVzcwAAAAAAAAVBZG1pbgAAAAAAAAAAAAAZR2FtZSBIdWIgY29udHJhY3QgYWRkcmVzcwAAAAAAAA5HYW1lSHViQWRkcmVzcwAA",
        "AAAAAQAAACBBIHJlY29yZCBvZiBhIHNpbmdsZSBkaWcgYWN0aW9uLgAAAAAAAAAJRGlnUmVjb3JkAAAAAAAAAwAAAAAAAAAGZGlnZ2VyAAAAAAATAAAAAAAAAAlpc2xhbmRfaWQAAAAAAAAEAAAAAAAAAAd0aWxlX2lkAAAAAAQ=",
        "AAAAAAAAACZEaWcgYSB0aWxlLiBNdXN0IGJlIHRoZSBjYWxsZXIncyB0dXJuLgAAAAAAA2RpZwAAAAAEAAAAAAAAAAdyb29tX2lkAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAJaXNsYW5kX2lkAAAAAAAABAAAAAAAAAAHdGlsZV9pZAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAClBbGlhcyB1c2VkIGJ5IHRoZSBmcm9udGVuZCBzZXJ2aWNlIGxheWVyLgAAAAAAAAhnZXRfZ2FtZQAAAAEAAAAAAAAAB3Jvb21faWQAAAAABAAAAAEAAAfQAAAABFJvb20=",
        "AAAAAAAAADRSZWFkIHJvb20gc3RhdGUgKHJldHVybnMgdGhlIFJvb20gc3RydWN0IG9yIHBhbmljcykuAAAACGdldF9yb29tAAAAAQAAAAAAAAAHcm9vbV9pZAAAAAAEAAAAAQAAB9AAAAAEUm9vbQ==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAACBQbGF5ZXIgQiBqb2lucyBhbiBleGlzdGluZyByb29tLgAAAAlqb2luX3Jvb20AAAAAAAADAAAAAAAAAAdyb29tX2lkAAAAAAQAAAAAAAAACHBsYXllcl9iAAAAEwAAAAAAAAAPcGxheWVyX2JfcG9pbnRzAAAAAAsAAAABAAAH0AAAAARSb29t",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAADtCb3RoIHBsYXllcnMgY28tc2lnbiB0byBzdGFydC4gQ2FsbHMgR2FtZSBIdWIgYHN0YXJ0X2dhbWVgLgAAAAAKc3RhcnRfcm9vbQAAAAAABQAAAAAAAAAHcm9vbV9pZAAAAAAEAAAAAAAAAAhwbGF5ZXJfYQAAABMAAAAAAAAACHBsYXllcl9iAAAAEwAAAAAAAAAPcGxheWVyX2FfcG9pbnRzAAAAAAsAAAAAAAAAD3BsYXllcl9iX3BvaW50cwAAAAALAAAAAQAAB9AAAAAEUm9vbQ==",
        "AAAAAAAAACtDcmVhdGUgYSBuZXcgcm9vbS4gQ2FsbGVyIGJlY29tZXMgUGxheWVyIEEuAAAAAAtjcmVhdGVfcm9vbQAAAAADAAAAAAAAAAdyb29tX2lkAAAAAAQAAAAAAAAACHBsYXllcl9hAAAAEwAAAAAAAAAPcGxheWVyX2FfcG9pbnRzAAAAAAsAAAABAAAH0AAAAARSb29t",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAAIpTdWJtaXQgYSBjb21taXRtZW50ID0gU0hBLTI1Nihyb29tX2lkIOKAliBpc2xhbmRfaWQg4oCWIHRpbGVfaWQg4oCWIHNhbHQpLgpUaGUgcHJlLWltYWdlIGlzIGtlcHQgc2VjcmV0OyBvbmx5IHRoZSBoYXNoIGlzIHN0b3JlZCBvbi1jaGFpbi4AAAAAAA1idXJ5X3RyZWFzdXJlAAAAAAAAAwAAAAAAAAAHcm9vbV9pZAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAA==",
        "AAAAAAAAANZSZXZlYWwgdGhlIE9QUE9ORU5UJ3MgdHJlYXN1cmUgdG8gY2xhaW0gdmljdG9yeS4KClRoZSBjYWxsZXIgcHJvdmlkZXMgKGlzbGFuZF9pZCwgdGlsZV9pZCwgc2FsdCkuIFRoZSBjb250cmFjdApyZWhhc2hlcyBhbmQgY2hlY2tzIGFnYWluc3QgdGhlICoqb3Bwb25lbnQncyoqIHN0b3JlZCBjb21taXRtZW50LgpJZiB0aGUgaGFzaCBtYXRjaGVzLCB0aGUgY2FsbGVyIHdpbnMuAAAAAAAPcmV2ZWFsX3RyZWFzdXJlAAAAAAUAAAAAAAAAB3Jvb21faWQAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAlpc2xhbmRfaWQAAAAAAAAEAAAAAAAAAAd0aWxlX2lkAAAAAAQAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    dig: this.txFromJSON<null>,
    get_hub: this.txFromJSON<string>,
    set_hub: this.txFromJSON<null>,
    upgrade: this.txFromJSON<null>,
    get_game: this.txFromJSON<Room>,
    get_room: this.txFromJSON<Room>,
    get_admin: this.txFromJSON<string>,
    join_room: this.txFromJSON<Room>,
    set_admin: this.txFromJSON<null>,
    start_room: this.txFromJSON<Room>,
    create_room: this.txFromJSON<Room>,
    bury_treasure: this.txFromJSON<null>,
    reveal_treasure: this.txFromJSON<null>,
  }
}