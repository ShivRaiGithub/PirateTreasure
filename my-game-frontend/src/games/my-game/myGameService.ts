import { Client as MyGameClient, type Room } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, TransactionBuilder, StrKey, xdr, Address, authorizeEntry, nativeToScVal } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';
import { hexToBytes } from './zkUtils';

type ClientOptions = contract.ClientOptions;

/**
 * Service for interacting with the Pirate's Treasure contract.
 *
 * Game flow: create_room → join_room → start_room → bury_treasure (×2) → dig/reveal_treasure
 *
 * The start_room call is the multi-sig step (same pattern as number-guess's start_game).
 * All other calls are single-player signed.
 */
export class MyGameService {
  private baseClient: MyGameClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new MyGameClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): MyGameClient {
    return new MyGameClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    });
  }

  // ========================================================================
  // Read-only queries
  // ========================================================================

  /** Get room state. Returns null when the room does not exist. */
  async getRoom(roomId: number): Promise<Room | null> {
    try {
      const tx = await this.baseClient.get_room({ room_id: roomId });
      const result = await tx.simulate();
      // Bindings return Room directly (not Result<Room>),
      // so result.result IS the Room object.
      const val = result.result;
      if (val && typeof val === 'object') {
        // If the SDK wraps it in a Result, unwrap it
        if ('isOk' in val && typeof (val as any).isOk === 'function') {
          if ((val as any).isOk()) return (val as any).unwrap() as Room;
          return null;
        }
        // Direct Room object
        return val as Room;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Alias kept for compatibility with code that references getGame */
  async getGame(sessionId: number): Promise<Room | null> {
    return this.getRoom(sessionId);
  }

  // ========================================================================
  // Room lifecycle (single-sig calls)
  // ========================================================================

  /** Create a new room */
  async createRoom(
    roomId: number,
    playerA: string,
    playerAPoints: bigint,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(playerA, signer);
    const tx = await client.create_room({
      room_id: roomId,
      player_a: playerA,
      player_a_points: playerAPoints,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sent = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
    return sent.result;
  }

  /** Join an existing room */
  async joinRoom(
    roomId: number,
    playerB: string,
    playerBPoints: bigint,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(playerB, signer);
    const tx = await client.join_room({
      room_id: roomId,
      player_b: playerB,
      player_b_points: playerBPoints,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sent = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
    return sent.result;
  }

  // ========================================================================
  // start_room — quickstart (both signers available, single-step)
  // ========================================================================

  /**
   * Quickstart: Build, sign, and submit start_room in ONE step.
   * Both player signers are available (dev mode), so we avoid the
   * multi-step prepare → import → finalize round-trip entirely.
   * This prevents auth entries from being lost during re-simulation.
   */
  async quickstartStartRoom(
    roomId: number,
    playerA: string,
    playerB: string,
    playerAPoints: bigint,
    playerBPoints: bigint,
    playerASigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    playerBSigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    // Build tx with Player B as source (invoker)
    const buildClient = this.createSigningClient(playerB, playerBSigner);
    const tx = await buildClient.start_room({
      room_id: roomId,
      player_a: playerA,
      player_b: playerB,
      player_a_points: playerAPoints,
      player_b_points: playerBPoints,
    }, DEFAULT_METHOD_OPTIONS);
    // tx is now auto-simulated by the SDK. simulationData contains auth stubs.

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in start_room simulation');
    }

    // Sign Player A's address-based auth entry in-place
    const validUntil = await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);
    const authEntries = tx.simulationData.result.auth;
    let signedPlayerA = false;

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') continue;
        const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
        if (addr !== playerA) continue;

        if (!playerASigner.signAuthEntry) throw new Error('Player A signAuthEntry not available');
        authEntries[i] = await authorizeEntry(
          entry,
          async (preimage) => {
            const result = await playerASigner.signAuthEntry!(
              preimage.toXDR('base64'),
              { networkPassphrase: NETWORK_PASSPHRASE, address: playerA },
            );
            if (result.error) throw new Error(`Player A sign failed: ${result.error.message}`);
            return Buffer.from(result.signedAuthEntry, 'base64');
          },
          validUntil,
          NETWORK_PASSPHRASE,
        );
        signedPlayerA = true;
        break;
      } catch (e) {
        if (e instanceof Error && e.message.includes('sign')) throw e;
        continue;
      }
    }

    if (!signedPlayerA) {
      throw new Error('Could not find Player A auth entry to sign');
    }

    // Send directly — Player B signs the envelope as source account.
    // NO re-simulation. The signed auth entry is still in simulationData.
    const sent = await tx.signAndSend({ force: true });

    if (sent.getTransactionResponse?.status === 'FAILED') {
      const diagMsg = this.extractError(sent.getTransactionResponse);
      throw new Error(`start_room on-chain failure: ${diagMsg}`);
    }

    return sent.result;
  }

  // ========================================================================
  // start_room — multi-sig flow (manual, two-browser)
  // ========================================================================

  /**
   * STEP 1 (Player A): Prepare start_room auth entry
   */
  async prepareStartRoom(
    roomId: number,
    playerA: string,
    playerB: string,
    playerAPoints: bigint,
    playerBPoints: bigint,
    playerASigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ): Promise<string> {
    const buildClient = new MyGameClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: playerB,
    });

    const tx = await buildClient.start_room({
      room_id: roomId,
      player_a: playerA,
      player_b: playerB,
      player_a_points: playerAPoints,
      player_b_points: playerBPoints,
    }, DEFAULT_METHOD_OPTIONS);

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    let playerAAuthEntry = null;

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const entryAddress = entry.credentials().address().address();
        const addr = Address.fromScAddress(entryAddress).toString();
        if (addr === playerA) {
          playerAAuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!playerAAuthEntry) throw new Error('No auth entry found for Player A');

    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!playerASigner.signAuthEntry) throw new Error('signAuthEntry not available');

    const signedAuth = await authorizeEntry(
      playerAAuthEntry,
      async (preimage) => {
        const signResult = await playerASigner.signAuthEntry!(
          preimage.toXDR('base64'),
          { networkPassphrase: NETWORK_PASSPHRASE, address: playerA },
        );
        if (signResult.error) throw new Error(`Sign failed: ${signResult.error.message}`);
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntil,
      NETWORK_PASSPHRASE,
    );

    return signedAuth.toXDR('base64');
  }

  /** Parse auth entry for start_room */
  parseAuthEntry(authEntryXdr: string) {
    const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
    const addressCreds = authEntry.credentials().address();
    const playerA = Address.fromScAddress(addressCreds.address()).toString();
    const rootInvocation = authEntry.rootInvocation();
    const contractFn = rootInvocation.function().contractFn();
    const functionName = contractFn.functionName().toString();

    if (functionName !== 'start_room') {
      throw new Error(`Unexpected function: ${functionName}, expected start_room`);
    }

    const args = contractFn.args();
    // start_room has 5 args: room_id, player_a, player_b, player_a_points, player_b_points
    if (args.length !== 5) throw new Error(`Expected 5 args, got ${args.length}`);

    const sessionId = args[0].u32();
    const playerAPoints = args[3].i128().lo().toBigInt();

    return { sessionId, playerA, playerAPoints, functionName };
  }

  /**
   * STEP 2 (Player B): Import auth, rebuild, sign, return full TX XDR
   */
  async importAndSignAuthEntry(
    playerAAuthXdr: string,
    playerBAddress: string,
    playerBPoints: bigint,
    playerBSigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ): Promise<string> {
    const params = this.parseAuthEntry(playerAAuthXdr);
    if (playerBAddress === params.playerA) throw new Error('Cannot play against yourself');

    const buildClient = new MyGameClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: playerBAddress,
    });

    const tx = await buildClient.start_room({
      room_id: params.sessionId,
      player_a: params.playerA,
      player_b: playerBAddress,
      player_a_points: params.playerAPoints,
      player_b_points: playerBPoints,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    const txWithInjected = await injectSignedAuthEntry(
      tx, playerAAuthXdr, playerBAddress, playerBSigner, validUntil,
    );

    // Player B is the invoker (transaction source) so their auth is satisfied
    // by the envelope signature — no additional auth entry signing is needed.
    // Important: We return the XDR directly instead of doing txFromXDR →
    // needsNonInvokerSigningBy, which would trigger a re-simulation that
    // can lose Player A's already-signed auth entry.
    return txWithInjected.toXDR();
  }

  /**
   * STEP 3: Submit the fully-signed start_room TX.
   * We must NOT re-simulate because that replaces Player A's signed auth
   * entry with an unsigned stub, causing the on-chain call to fail.
   */
  async finalizeStartRoom(
    xdrString: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    _authTtlMinutes?: number,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(xdrString);

    // Grab the signed auth entries that are already baked into the XDR
    // BEFORE simulate() overwrites them.
    let savedAuth: xdr.SorobanAuthorizationEntry[] | null = null;
    try {
      const built = tx.built;
      if (built) {
        const ops = built.operations;
        if (ops.length > 0 && ops[0].type === 'invokeHostFunction') {
          const invokeOp = ops[0] as any;
          if (invokeOp.auth && invokeOp.auth.length > 0) {
            savedAuth = [...invokeOp.auth];
          }
        }
      }
    } catch { /* ignore — we'll try without restore */ }

    // simulate() is required to populate simulationData so signAndSend works
    await tx.simulate();

    // Restore previous (signed) auth entries, because simulate() replaced
    // them with unsigned stubs from the fresh simulation.
    if (savedAuth && tx.simulationData?.result?.auth) {
      tx.simulationData.result.auth = savedAuth;
    }

    const sent = await tx.signAndSend({ force: true });

    if (sent.getTransactionResponse?.status === 'FAILED') {
      const diagMsg = this.extractError(sent.getTransactionResponse);
      throw new Error(`start_room transaction failed: ${diagMsg}`);
    }

    return sent.result;
  }

  /** Parse start_room TX XDR for display purposes */
  parseTransactionXDR(txXdr: string) {
    const transaction = TransactionBuilder.fromXDR(txXdr, NETWORK_PASSPHRASE);
    const source = 'source' in transaction ? transaction.source : '';
    const op = transaction.operations[0];
    if (!op || op.type !== 'invokeHostFunction') throw new Error('Not a contract call');

    const invokeArgs = op.func.invokeContract();
    const functionName = invokeArgs.functionName().toString();
    const args = invokeArgs.args();

    if (functionName !== 'start_room' || args.length !== 5) {
      throw new Error(`Unexpected ${functionName} with ${args.length} args`);
    }

    return {
      sessionId: args[0].u32(),
      player1: StrKey.encodeEd25519PublicKey(args[1].address().accountId().ed25519()),
      player2: StrKey.encodeEd25519PublicKey(args[2].address().accountId().ed25519()),
      player1Points: args[3].i128().lo().toBigInt(),
      player2Points: args[4].i128().lo().toBigInt(),
      transactionSource: source,
      functionName,
    };
  }

  // ========================================================================
  // Game-play calls (single-sig)
  // ========================================================================

  /** Bury treasure: submit a SHA-256 commitment */
  async buryTreasure(
    roomId: number,
    playerAddress: string,
    commitmentHex: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(playerAddress, signer);
    const tx = await client.bury_treasure({
      room_id: roomId,
      player: playerAddress,
      commitment: Buffer.from(hexToBytes(commitmentHex)),
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    try {
      const sent = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
      if (sent.getTransactionResponse?.status === 'FAILED') {
        throw new Error(this.extractError(sent.getTransactionResponse));
      }
      return sent.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Transaction failed – check that you are in the burying phase');
      }
      throw err;
    }
  }

  /** Dig a tile */
  async dig(
    roomId: number,
    playerAddress: string,
    islandId: number,
    tileId: number,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(playerAddress, signer);
    const tx = await client.dig({
      room_id: roomId,
      player: playerAddress,
      island_id: islandId,
      tile_id: tileId,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    try {
      const sent = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
      if (sent.getTransactionResponse?.status === 'FAILED') {
        throw new Error(this.extractError(sent.getTransactionResponse));
      }
      return sent.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Dig failed – check turn order, island, and tile validity');
      }
      throw err;
    }
  }

  /** Reveal the opponent's treasure by providing the pre-image (island, tile, salt). */
  async revealTreasure(
    roomId: number,
    playerAddress: string,
    islandId: number,
    tileId: number,
    salt: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(playerAddress, signer);
    const tx = await client.reveal_treasure({
      room_id: roomId,
      player: playerAddress,
      island_id: islandId,
      tile_id: tileId,
      salt,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    try {
      const sent = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
      if (sent.getTransactionResponse?.status === 'FAILED') {
        throw new Error(this.extractError(sent.getTransactionResponse));
      }
      return sent.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Reveal failed – check that you have found the opponent\'s tile');
      }
      throw err;
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private extractError(resp: any): string {
    try {
      const events = resp?.diagnosticEventsXdr || resp?.diagnostic_events || [];
      for (const event of events) {
        if (event?.topics) {
          const hasErr = (Array.isArray(event.topics) ? event.topics : []).some(
            (t: any) => t?.symbol === 'error' || t?.error,
          );
          if (hasErr && event.data) {
            if (typeof event.data === 'string') return event.data;
            if (event.data.vec) {
              const msgs = event.data.vec
                .filter((i: any) => i?.string)
                .map((i: any) => i.string);
              if (msgs.length) return msgs.join(': ');
            }
          }
        }
      }
      return `Transaction ${resp?.status || 'Unknown'}. See console.`;
    } catch {
      return 'Transaction failed with unknown error';
    }
  }
}
