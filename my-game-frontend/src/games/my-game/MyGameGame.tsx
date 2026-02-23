import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MyGameService } from './myGameService';
import { useWallet } from '@/hooks/useWallet';
import { MY_GAME_CONTRACT } from '@/utils/constants';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { Room, DigRecord } from './bindings';
import {
  generateCommitment,
  generateSalt,
  addressToFieldHash,
  hexToBytes,
  treasureVault,
  type TreasureLocation,
} from './zkUtils';

// ============================================================================
// Helpers
// ============================================================================

const createRandomRoomId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    let value = 0;
    while (value === 0) { crypto.getRandomValues(buffer); value = buffer[0]; }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

const PHASE_LABELS: Record<number, string> = { 0: 'Waiting', 1: 'Burying', 2: 'Playing', 3: 'Ended' };
const ISLAND_NAMES = ['Skull Island', 'Palm Atoll', 'Volcano Isle'];
const ISLAND_EMOJIS = ['💀', '🌴', '🌋'];

const myGameService = new MyGameService(MY_GAME_CONTRACT);

// ============================================================================
// Component
// ============================================================================

interface MyGameGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

export function MyGameGame({
  userAddress,
  onStandingsRefresh,
  onGameComplete,
}: MyGameGameProps) {
  const { getContractSigner, walletType } = useWallet();

  // ---- State ----
  const [roomId, setRoomId] = useState(() => createRandomRoomId());
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Bury treasure
  const [buryIsland, setBuryIsland] = useState<number>(0);
  const [buryTile, setBuryTile] = useState<number>(0);

  // Dig
  const [digIsland, setDigIsland] = useState<number>(0);
  const [digTile, setDigTile] = useState<number>(0);

  // Client-side discovery: set ONLY when a dug tile's hash matches the opponent's commitment
  const [discoveredTreasure, setDiscoveredTreasure] = useState<TreasureLocation | null>(null);

  const actionLock = useRef(false);
  const isBusy = loading || quickstartLoading;

  // ---- Reset per-player UI state on wallet switch ----
  const prevAddress = useRef(userAddress);
  useEffect(() => {
    if (prevAddress.current !== userAddress) {
      prevAddress.current = userAddress;
      // Clear tile selections — they belong to the previous player
      setBuryIsland(0);
      setBuryTile(0);
      setDigIsland(0);
      setDigTile(0);
      setDiscoveredTreasure(null);
      setError(null);
      setSuccess(null);
    }
  }, [userAddress]);

  // Derived state
  const isPlayerA = room?.player_a === userAddress;
  const isPlayerB = room?.player_b === userAddress;
  const isMyTurn = room ? (room.turn_is_a ? isPlayerA : isPlayerB) : false;
  const phase = room?.phase ?? -1;
  const quickstartAvailable =
    walletType === 'dev' &&
    DevWalletService.isDevModeAvailable() &&
    DevWalletService.isPlayerAvailable(1) &&
    DevWalletService.isPlayerAvailable(2);

  // ---- Helpers ----
  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) return;
    actionLock.current = true;
    try { await action(); } finally { actionLock.current = false; }
  };

  const addr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  // ---- Poll room state ----
  const loadRoom = useCallback(async () => {
    const r = await myGameService.getRoom(roomId);
    if (r) setRoom(r);
  }, [roomId]);

  useEffect(() => {
    if (phase < 0) return; // no room yet
    loadRoom();
    const iv = setInterval(loadRoom, 5000);
    return () => clearInterval(iv);
  }, [roomId, phase, loadRoom]);

  useEffect(() => {
    if (phase === 3 && room?.winner) {
      onStandingsRefresh();
    }
  }, [phase, room?.winner]);

  // ---- Island tile grid helper ----
  const tileCounts = useMemo(() => {
    if (!room) return [10, 10, 10];
    return room.island_tile_counts.length ? room.island_tile_counts.map(Number) : [10, 10, 10];
  }, [room]);

  // FOG OF WAR: Only digs made by the current player are visible
  const myDugTiles = useMemo(() => {
    const set = new Set<string>();
    if (room?.digs) {
      for (const d of room.digs as DigRecord[]) {
        if (d.digger === userAddress) {
          set.add(`${d.island_id}-${d.tile_id}`);
        }
      }
    }
    return set;
  }, [room, userAddress]);

  // Dig history filtered to current player only
  const myDigHistory = useMemo(() => {
    if (!room?.digs) return [];
    return (room.digs as DigRecord[]).filter(d => d.digger === userAddress);
  }, [room, userAddress]);

  // Reveal is gated on hash-verified discovery — NOT mere vault existence.
  // discoveredTreasure must be non-null (a dug tile's hash matched the opponent's commitment).
  const canReveal = useMemo(() => {
    if (!room || phase !== 2 || !isMyTurn) return false;
    return !!discoveredTreasure;
  }, [room, phase, isMyTurn, discoveredTreasure]);

  // Auto-scan: whenever room digs change, check if any of our digs match the
  // opponent's commitment. Handles reconnect / component re-mount scenarios.
  useEffect(() => {
    // Already discovered — no need to rescan
    if (discoveredTreasure) return;
    if (!room || phase !== 2) return;

    const opponentAddress = isPlayerA ? room.player_b : room.player_a;
    const opponentLocation = treasureVault.getByOwner(roomId, opponentAddress);
    if (!opponentLocation) return;

    const myDigs = (room.digs as DigRecord[]).filter(d => d.digger === userAddress);
    if (myDigs.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const dig of myDigs) {
        if (cancelled) return;
        const ownerHash = await addressToFieldHash(opponentLocation.ownerAddress);
        const computed = await generateCommitment(
          roomId, dig.island_id, dig.tile_id, ownerHash, opponentLocation.salt,
        );
        if (computed === opponentLocation.commitment) {
          if (!cancelled) setDiscoveredTreasure(opponentLocation);
          return;
        }
      }
    })();

    return () => { cancelled = true; };
  }, [room, phase, isPlayerA, roomId, userAddress, discoveredTreasure]);

  // ============================================================================
  // Handlers
  // ============================================================================

  /** Bury treasure — generate commitment + call contract */
  const handleBuryTreasure = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        const salt = generateSalt();
        const ownerHash = await addressToFieldHash(userAddress);
        const commitment = await generateCommitment(roomId, buryIsland, buryTile, ownerHash, salt);

        // Save locally (never sent to server)
        const location: TreasureLocation = {
          roomId,
          islandId: buryIsland,
          tileId: buryTile,
          ownerAddress: userAddress,
          salt,
          commitment,
        };
        treasureVault.store(roomId, location);

        const signer = getContractSigner();
        await myGameService.buryTreasure(roomId, userAddress, commitment, signer);
        setSuccess(`Treasure buried on ${ISLAND_NAMES[buryIsland]}, tile ${buryTile}!`);
        await loadRoom();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to bury treasure');
      } finally {
        setLoading(false);
      }
    });
  };

  /** Dig a tile — then immediately check for treasure discovery via hash comparison. */
  const handleDig = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        const signer = getContractSigner();
        await myGameService.dig(roomId, userAddress, digIsland, digTile, signer);
        await loadRoom();

        // ---- Client-side discovery check (hash verification) ----
        // Compute hash(room_id, island_id, tile_id, salt) for the just-dug tile
        // and compare against the opponent's stored commitment.
        if (!discoveredTreasure && room) {
          const opponentAddress = isPlayerA ? room.player_b : room.player_a;
          const opponentLocation = treasureVault.getByOwner(roomId, opponentAddress);
          if (opponentLocation) {
            const ownerHash = await addressToFieldHash(opponentLocation.ownerAddress);
            const computed = await generateCommitment(
              roomId, digIsland, digTile, ownerHash, opponentLocation.salt,
            );
            if (computed === opponentLocation.commitment) {
              setDiscoveredTreasure(opponentLocation);
              setSuccess(
                `\u{1F3F4}\u200D\u2620\uFE0F Treasure discovered on ${ISLAND_NAMES[digIsland]} tile ${digTile}! ` +
                'Wait for your next turn, then click Reveal to win!'
              );
              return; // keep success message visible (no auto-clear)
            }
          }
        }

        setSuccess(`Dug tile ${digTile} on ${ISLAND_NAMES[digIsland]}. Nothing found.`);
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dig failed');
      } finally {
        setLoading(false);
      }
    });
  };

  /** Reveal treasure — hash pre-verification + submit opponent's pre-image. */
  const handleRevealTreasure = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);

        if (!room) throw new Error('Room not loaded');

        // STRICT GATE: discoveredTreasure must be set (hash-verified).
        if (!discoveredTreasure) {
          throw new Error(
            'No treasure discovered yet. Dig tiles to find the opponent\'s treasure first!'
          );
        }

        // ---- Hash pre-verification (MANDATORY before contract call) ----
        const ownerHash = await addressToFieldHash(discoveredTreasure.ownerAddress);
        const recomputed = await generateCommitment(
          roomId,
          discoveredTreasure.islandId,
          discoveredTreasure.tileId,
          ownerHash,
          discoveredTreasure.salt,
        );
        if (recomputed !== discoveredTreasure.commitment) {
          throw new Error('Hash pre-check failed — discovery data may be corrupted.');
        }

        const salt = Buffer.from(hexToBytes(discoveredTreasure.salt));
        const signer = getContractSigner();
        await myGameService.revealTreasure(
          roomId,
          userAddress,
          discoveredTreasure.islandId,
          discoveredTreasure.tileId,
          salt,
          signer,
        );

        await loadRoom();
        // Read updated room directly to avoid stale closure reference.
        const updatedRoom = await myGameService.getRoom(roomId);
        if (updatedRoom && updatedRoom.phase === 3 && updatedRoom.winner === userAddress) {
          setSuccess('\u{1F3C6} Treasure found! You win!');
        } else {
          setSuccess('Reveal submitted — awaiting on-chain confirmation.');
        }
        onStandingsRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reveal failed');
      } finally {
        setLoading(false);
      }
    });
  };

  /** Dev quickstart: create room + join + start_room + bury for both players */
  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        if (walletType !== 'dev') throw new Error('Quickstart only works with dev wallets.');
        if (!DevWalletService.isDevModeAvailable() ||
            !DevWalletService.isPlayerAvailable(1) ||
            !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Run "bun run setup" first.');
        }

        // Fixed stake: 0.1 XLM (1 000 000 stroops in 7-decimal representation)
        const pts = 1_000_000n;

        const orig = devWalletService.getCurrentPlayer();
        let a = '', b = '';
        let aSigner: any, bSigner: any;
        try {
          await devWalletService.initPlayer(1);
          a = devWalletService.getPublicKey();
          aSigner = devWalletService.getSigner();
          await devWalletService.initPlayer(2);
          b = devWalletService.getPublicKey();
          bSigner = devWalletService.getSigner();
        } finally {
          if (orig) await devWalletService.initPlayer(orig);
        }

        const qsRoom = createRandomRoomId();
        // Do NOT call setRoomId(qsRoom) here — only update state AFTER all steps succeed
        // so a mid-flow failure never leaves stale roomId in state.

        // 1) create room — check first to avoid RoomExists on retry
        console.log('[Quickstart] Step 1: create room', qsRoom);
        const existingForQs = await myGameService.getRoom(qsRoom);
        if (!existingForQs) {
          await myGameService.createRoom(qsRoom, a, pts, aSigner);
          console.log('[Quickstart] Room created');
        } else if (existingForQs.phase > 0) {
          // Already started (e.g. a previous quickstart succeeded) — just load it.
          setRoomId(qsRoom);
          setRoom(existingForQs);
          onStandingsRefresh();
          setSuccess('Quickstart: room already started — resuming.');
          setTimeout(() => setSuccess(null), 3000);
          return;
        }

        // 2) join room (skip if player B already joined)
        console.log('[Quickstart] Step 2: join room');
        const roomAfterCreate = await myGameService.getRoom(qsRoom);
        if (!roomAfterCreate?.player_b || roomAfterCreate.player_b === roomAfterCreate.player_a) {
          await myGameService.joinRoom(qsRoom, b, pts, bSigner);
          console.log('[Quickstart] Player B joined');
        } else {
          console.log('[Quickstart] Player B already joined, skipping');
        }

        // 3) start_room — single step, both signers available, no XDR round-trip
        console.log('[Quickstart] Step 3: start_room (single-step)');
        const startResult = await myGameService.quickstartStartRoom(qsRoom, a, b, pts, pts, aSigner, bSigner);
        console.log('[Quickstart] start_room submitted, result:', startResult);

        // Read the room — the start_room call should have transitioned phase to 1.
        // Retry a few times to allow ledger propagation.
        let r: Room | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          r = await myGameService.getRoom(qsRoom);
          console.log(`[Quickstart] getRoom attempt ${attempt + 1}: phase =`, r?.phase, 'full room:', r);
          if (r && typeof r.phase === 'number' && r.phase >= 1) break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // If getRoom still can't read the room (possible ledger delay), try using
        // the result returned from quickstartStartRoom itself as fallback.
        if (!r || typeof r.phase !== 'number' || r.phase < 1) {
          // Attempt to use the return value from start_room
          if (startResult && typeof startResult === 'object' && 'phase' in startResult) {
            r = startResult as unknown as Room;
            console.log('[Quickstart] Using start_room return value as room data, phase:', r.phase);
          }
        }

        if (!r || typeof r.phase !== 'number' || r.phase < 1) {
          throw new Error(
            'start_room call completed but room phase did not advance. ' +
            'This may be a ledger propagation delay — please try clicking Quickstart again.'
          );
        }

        setRoomId(qsRoom);
        setRoom(r);
        onStandingsRefresh();
        setSuccess('Quickstart complete! Room ready for burying treasures.');
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        console.error('Quickstart error:', err);
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  const handleStartNew = () => {
    if (room?.winner) onGameComplete();
    actionLock.current = false;
    setRoomId(createRandomRoomId());
    setRoom(null);
    setLoading(false);
    setQuickstartLoading(false);
    setError(null);
    setSuccess(null);
    setBuryIsland(0);
    setBuryTile(0);
    setDigIsland(0);
    setDigTile(0);
    setDiscoveredTreasure(null);
  };

  // ============================================================================
  // Tile grid sub-component
  // ============================================================================

  const TileGrid = ({ islandIdx, tileCount, selected, onSelect, disabled }: {
    islandIdx: number; tileCount: number; selected: number; onSelect: (t: number) => void; disabled?: boolean;
  }) => {
    const cols = Math.min(tileCount, 10);
    return (
      <div className="mb-4">
        <h4 className="text-sm font-bold text-gray-700 mb-2">
          {ISLAND_EMOJIS[islandIdx]} {ISLAND_NAMES[islandIdx]} ({tileCount} tiles)
        </h4>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: tileCount }, (_, t) => {
            const key = `${islandIdx}-${t}`;
            // FOG OF WAR: only show the CURRENT player's digs as discovered
            const wasDug = myDugTiles.has(key);
            // Highlight the tile where opponent's treasure was hash-verified as found
            const isTreasureTile = disabled && discoveredTreasure?.islandId === islandIdx && discoveredTreasure?.tileId === t;
            const isSel = islandIdx === (disabled ? digIsland : buryIsland) && t === selected;
            return (
              <button
                key={t}
                disabled={disabled ? (wasDug || !isMyTurn || isBusy) : isBusy}
                onClick={() => {
                  if (disabled) { setDigIsland(islandIdx); setDigTile(t); }
                  else { setBuryIsland(islandIdx); setBuryTile(t); }
                  onSelect(t);
                }}
                className={`
                  w-full aspect-square rounded text-[10px] font-bold transition-all
                  ${isTreasureTile
                    ? 'bg-linear-to-br from-yellow-400 to-amber-500 text-white scale-110 shadow-xl border-2 border-yellow-300 ring-2 ring-yellow-400 animate-pulse'
                    : wasDug
                    ? 'bg-amber-200 text-amber-700 cursor-not-allowed border border-amber-300'
                    : isSel
                    ? 'bg-linear-to-br from-cyan-500 to-teal-500 text-white scale-105 shadow-lg border-2 border-cyan-300'
                    : 'bg-white border border-gray-200 text-gray-500 hover:border-cyan-300 hover:shadow'
                  }
                `}
                title={isTreasureTile ? '\u{1F4B0} Treasure found here!' : wasDug ? 'Already dug' : `Tile ${t}`}
              >
                {isTreasureTile ? '\u{1F4B0}' : wasDug ? '⛏️' : t}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-cyan-200">
      {/* Header */}
      <div className="flex items-center mb-6">
        <div>
          <h2 className="text-3xl font-black bg-linear-to-r from-cyan-600 via-teal-600 to-emerald-600 bg-clip-text text-transparent">
            ZK Treasure Hunt 🏴‍☠️
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">
            Hide treasure, dig for your opponent's, prove it with ZK!
          </p>
          <p className="text-xs text-gray-500 font-mono mt-1">
            Room {roomId} {room ? `| Phase: ${PHASE_LABELS[room.phase] || room.phase}` : ''}
          </p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-linear-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-linear-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* ============================== NO ROOM LOADED ============================== */}
      {(!room || phase < 0) && (
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="text-center">
            <div className="text-6xl mb-3">🏴‍☠️</div>
            <p className="text-gray-600 font-semibold">Start a new game with both dev wallets.</p>
          </div>
          <button
            onClick={handleQuickStart}
            disabled={isBusy || !quickstartAvailable}
            className="w-full py-5 rounded-xl font-bold text-lg text-white bg-linear-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
          >
            {quickstartLoading ? '⏳ Setting up...' : '⚡ Quickstart'}
          </button>
          {!quickstartAvailable && (
            <p className="text-xs text-gray-500 text-center">Dev wallets not available. Run <code className="font-mono bg-gray-100 px-1 rounded">bun run setup</code> first.</p>
          )}
        </div>
      )}

      {/* ============================== PHASE 0: WAITING ============================== */}
      {room && phase === 0 && (
        <div className="p-6 bg-linear-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 rounded-xl text-center">
          <div className="text-5xl mb-3">⏳</div>
          <h3 className="text-xl font-black text-gray-800 mb-2">Setting up game…</h3>
          <p className="text-sm text-gray-600">Room <span className="font-mono font-bold text-cyan-700">{roomId}</span> — waiting for both players to be ready.</p>
        </div>
      )}

      {/* ============================== PHASE 1: BURYING ============================== */}
      {room && phase === 1 && (
        <div className="space-y-6">
          <div className="p-4 bg-linear-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-xl text-center">
            <div className="text-4xl mb-2">🏴‍☠️</div>
            <h3 className="text-xl font-black text-gray-800 mb-1">Bury Your Treasure!</h3>
            <p className="text-sm text-gray-600">Pick an island and tile. Nobody will see where you hide it.</p>
          </div>

          {/* Player panels */}
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-4 rounded-xl border-2 ${isPlayerA ? 'border-cyan-400 bg-cyan-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500 mb-1">Player A {isPlayerA && '(You)'}</div>
              <div className="font-mono text-xs text-gray-700">{addr(room.player_a)}</div>
              <div className="mt-2 text-xs">
                {room.has_commitment_a
                  ? <span className="text-green-600 font-bold">✓ Buried</span>
                  : <span className="text-amber-600 font-bold">Waiting...</span>}
              </div>
            </div>
            <div className={`p-4 rounded-xl border-2 ${isPlayerB ? 'border-cyan-400 bg-cyan-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500 mb-1">Player B {isPlayerB && '(You)'}</div>
              <div className="font-mono text-xs text-gray-700">{room.player_b ? addr(room.player_b) : '—'}</div>
              <div className="mt-2 text-xs">
                {room.has_commitment_b
                  ? <span className="text-green-600 font-bold">✓ Buried</span>
                  : <span className="text-amber-600 font-bold">Waiting...</span>}
              </div>
            </div>
          </div>

          {/* My commitment status */}
          {((isPlayerA && !room.has_commitment_a) || (isPlayerB && !room.has_commitment_b)) ? (
            <div className="space-y-4">
              <p className="text-sm font-bold text-gray-700">Choose where to bury:</p>
              {tileCounts.map((tc, i) => (
                <TileGrid
                  key={i}
                  islandIdx={i}
                  tileCount={tc}
                  selected={buryIsland === i ? buryTile : -1}
                  onSelect={(t) => { setBuryIsland(i); setBuryTile(t); }}
                />
              ))}
              <button
                onClick={handleBuryTreasure}
                disabled={isBusy}
                className="w-full py-4 rounded-xl font-bold text-white bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
              >
                {loading ? 'Burying...' : `Bury on ${ISLAND_NAMES[buryIsland]}, Tile ${buryTile}`}
              </button>
            </div>
          ) : (
            <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl text-center">
              <p className="text-sm font-semibold text-blue-700">✓ You've buried your treasure. Waiting for opponent...</p>
            </div>
          )}
        </div>
      )}

      {/* ============================== PHASE 2: PLAYING ============================== */}
      {room && phase === 2 && (
        <div className="space-y-6">
          <div className="p-4 bg-linear-to-br from-cyan-50 to-blue-50 border-2 border-cyan-200 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-lg font-black text-gray-800">Turn: </span>
              <span className={`text-lg font-black ${isMyTurn ? 'text-green-600' : 'text-gray-500'}`}>
                {isMyTurn ? 'Your move!' : 'Waiting for opponent...'}
              </span>
            </div>
            <div className="text-xs font-mono text-gray-500">{myDigHistory.length} of your digs</div>
          </div>

          {/* Discovery banner — only shown when hash-verified discovery is confirmed */}
          {discoveredTreasure && (
            <div className="p-4 bg-linear-to-r from-yellow-50 to-amber-50 border-2 border-yellow-300 rounded-xl flex items-center gap-3">
              <span className="text-2xl">💰</span>
              <div>
                <p className="text-sm font-black text-yellow-800">Treasure Discovered!</p>
                <p className="text-xs text-yellow-700">
                  Found on {ISLAND_NAMES[discoveredTreasure.islandId]} tile {discoveredTreasure.tileId}.
                  {isMyTurn ? ' Click Reveal to claim victory!' : ' Wait for your turn to Reveal.'}
                </p>
              </div>
            </div>
          )}

          {/* Player panels */}
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-4 rounded-xl border-2 ${isPlayerA ? 'border-cyan-400 bg-cyan-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500 mb-1">Player A {isPlayerA && '(You)'}</div>
              <div className="font-mono text-xs text-gray-700">{addr(room.player_a)}</div>
            </div>
            <div className={`p-4 rounded-xl border-2 ${isPlayerB ? 'border-cyan-400 bg-cyan-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500 mb-1">Player B {isPlayerB && '(You)'}</div>
              <div className="font-mono text-xs text-gray-700">{room.player_b ? addr(room.player_b) : '—'}</div>
            </div>
          </div>

          {/* Islands / dig grid */}
          <div>
            <p className="text-sm font-bold text-gray-700 mb-3">Select a tile to dig:</p>
            {tileCounts.map((tc, i) => (
              <TileGrid
                key={i}
                islandIdx={i}
                tileCount={tc}
                selected={digIsland === i ? digTile : -1}
                onSelect={(t) => { setDigIsland(i); setDigTile(t); }}
                disabled
              />
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleDig}
              disabled={isBusy || !isMyTurn}
              className="flex-1 py-4 rounded-xl font-bold text-white bg-linear-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
            >
              {loading ? 'Digging...' : `Dig ${ISLAND_NAMES[digIsland]} Tile ${digTile}`}
            </button>
            {/* Reveal button: ONLY shown when player has the opponent's pre-image */}
            {canReveal && (
              <button
                onClick={handleRevealTreasure}
                disabled={isBusy || !isMyTurn}
                className="py-4 px-6 rounded-xl font-bold text-white bg-linear-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
                title="Submit ZK proof to claim you found the treasure"
              >
                🔐 Reveal (ZK Proof)
              </button>
            )}
          </div>

          {/* Dig history — FOG OF WAR: only show current player's digs */}
          {myDigHistory.length > 0 && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <p className="text-xs font-bold text-gray-600 mb-2">Your Dig History</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...myDigHistory].reverse().map((d: DigRecord, i: number) => {
                  const isDiscoveryDig = discoveredTreasure?.islandId === d.island_id && discoveredTreasure?.tileId === d.tile_id;
                  return (
                    <div key={i} className={`text-xs flex items-center gap-2 ${isDiscoveryDig ? 'text-yellow-700 font-bold' : 'text-gray-600'}`}>
                      <span className="font-mono text-gray-400">{myDigHistory.length - i}.</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-semibold">{ISLAND_NAMES[d.island_id]} tile {d.tile_id}</span>
                      {isDiscoveryDig && <span className="text-yellow-600">💰 Treasure!</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================== PHASE 3: ENDED ============================== */}
      {room && phase === 3 && (
        <div className="space-y-6">
          <div className="p-10 bg-linear-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-300 rounded-2xl text-center shadow-2xl">
            <div className="text-7xl mb-6">🏆</div>
            <h3 className="text-3xl font-black text-gray-900 mb-4">Game Over!</h3>

            {room.winner && (
              <div className="p-5 bg-white border-2 border-green-200 rounded-xl shadow-lg mb-6">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">Winner</p>
                <p className="font-mono text-sm font-bold text-gray-800">{addr(room.winner)}</p>
                {room.winner === userAddress && (
                  <p className="mt-3 text-green-700 font-black text-lg">🎉 You won!</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-left mb-6">
              <div className="p-4 bg-white/70 border border-green-200 rounded-xl">
                <p className="text-xs font-bold uppercase text-gray-500 mb-1">Player A</p>
                <p className="font-mono text-xs text-gray-700">{addr(room.player_a)}</p>
              </div>
              <div className="p-4 bg-white/70 border border-green-200 rounded-xl">
                <p className="text-xs font-bold uppercase text-gray-500 mb-1">Player B</p>
                <p className="font-mono text-xs text-gray-700">{room.player_b ? addr(room.player_b) : '—'}</p>
              </div>
            </div>

            <p className="text-sm text-gray-500">{room.digs.length} total digs played</p>
          </div>

          <button
            onClick={handleStartNew}
            className="w-full py-4 rounded-xl font-bold text-gray-700 bg-linear-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all shadow-lg"
          >
            Start New Game
          </button>
        </div>
      )}
    </div>
  );
}
