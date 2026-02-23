 bun run setup
$ bun run scripts/setup.ts
🎮 Stellar Game Studio Setup

This will:
  0. Install JavaScript dependencies (if needed)
  1. Build Soroban contracts
  2. Deploy to Stellar testnet
  3. Generate TypeScript bindings
  4. Write local testnet configuration

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1/4: Building contracts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ bun run scripts/build.ts
🔨 Building Soroban contracts...

Building mock-game-hub...
ℹ️  CARGO_BUILD_RUSTFLAGS=--remap-path-prefix=/home/shiv/.cargo/registry/src= cargo rustc --manifest-path=contracts/mock-game-hub/Cargo.toml --crate-type=cdylib --target=wasm32v1-none --release
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/mock-game-hub/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/my-game/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml: unused manifest key: workspace.version
    Finished `release` profile [optimized] target(s) in 0.07s
ℹ️  Build Summary:
    Wasm File: target/wasm32v1-none/release/mock_game_hub.wasm (2588 bytes)
    Wasm Hash: d7df0f5989c41e4bdbac32cfecf2bcafab0d02c6ba9a1f31fc07fb64ce32810a
    Wasm Size: 2588 bytes
    Exported Functions: 2 found
      • end_game
      • start_game
✅ Build Complete

✅ mock-game-hub built

Building my-game...
ℹ️  CARGO_BUILD_RUSTFLAGS=--remap-path-prefix=/home/shiv/.cargo/registry/src= cargo rustc --manifest-path=contracts/my-game/Cargo.toml --crate-type=cdylib --target=wasm32v1-none --release
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/mock-game-hub/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/my-game/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml: unused manifest key: workspace.version
    Finished `release` profile [optimized] target(s) in 0.05s
ℹ️  Build Summary:
    Wasm File: target/wasm32v1-none/release/my_game.wasm (13190 bytes)
    Wasm Hash: 900061fdb8c288686b3df8ded2e2179a792460a93baf0dddad77e1418bd74215
    Wasm Size: 13190 bytes
    Exported Functions: 14 found
      • __constructor
      • bury_treasure
      • create_room
      • dig
      • get_admin
      • get_game
      • get_hub
      • get_room
      • join_room
      • reveal_treasure
      • set_admin
      • set_hub
      • start_room
      • upgrade
✅ Build Complete

✅ my-game built

🎉 Contracts built successfully!

WASM files:
  - target/wasm32v1-none/release/mock_game_hub.wasm
  - target/wasm32v1-none/release/my_game.wasm

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 2/4: Deploying to testnet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ bun run scripts/deploy.ts
🚀 Deploying contracts to Stellar testnet...

Setting up admin identity...
📝 Generating new admin identity...
💰 Funding GBAOVRPVVWSYAYFWLWAGY6BN6YQ6I36CFL7ZKJAXIRE3DY6YCCMILZMG via friendbot...
✅ admin funded
⏳ Waiting for Soroban RPC to sync account (8s)…
Setting up player1...
✅ Using existing player1 from .env
✅ player1: GDPPQ2L23SON6P3T2MUVVNG4O4VXS5B46WRZVJI2XL3BU2WHOP3BN5B4
✅ player1 funded

Setting up player2...
✅ Using existing player2 from .env
✅ player2: GCVTQT7TDNU6WB5ATNFIG5J3R3ZEXNVHAQMP2VHDB6YEKFNVOTTKZ3XP
✅ player2 funded

🔐 Player secret keys will be saved to .env (gitignored)

💼 Wallet addresses:
  Admin:   GBAOVRPVVWSYAYFWLWAGY6BN6YQ6I36CFL7ZKJAXIRE3DY6YCCMILZMG
  Player1: GDPPQ2L23SON6P3T2MUVVNG4O4VXS5B46WRZVJI2XL3BU2WHOP3BN5B4
  Player2: GCVTQT7TDNU6WB5ATNFIG5J3R3ZEXNVHAQMP2VHDB6YEKFNVOTTKZ3XP

✅ Using existing mock-game-hub on testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG

Deploying my-game...
  Uploading WASM...
  WASM hash: 900061fdb8c288686b3df8ded2e2179a792460a93baf0dddad77e1418bd74215
  Deploying and initializing...
❌ Failed to deploy my-game: 323 |     )).trim();
324 |     console.log(`  WASM hash: ${wasmHash}`);
325 | 
326 |     console.log("  Deploying and initializing...");
327 |     const contractId = (await runWithRetry(() =>
328 |       $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${mockGameHubId}`.text()
                     ^
ShellError: Failed with exit code 1
 exitCode: 1,
   stdout: "",
   stderr: "ℹ️  Using wasm hash 900061fdb8c288686b3df8ded2e2179a792460a93baf0dddad77e1418bd74215\n❌ error: Contract Code not found: 900061fdb8c288686b3df8ded2e2179a792460a93baf0dddad77e1418bd74215\n",

      at ShellPromise (unknown:75:16)
      at BunShell (unknown:191:35)
      at /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/scripts/deploy.ts:328:7
      at runWithRetry (/home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/scripts/deploy.ts:102:15)

error: script "deploy" exited with code 1

❌ Deployment failed. Please check the errors above.
error: script "setup" exited with code 1
shiv@Shiv:~/Codes/blockchain/piratetreasure/Stellar-Game-Studio$ bun run setup
$ bun run scripts/setup.ts
🎮 Stellar Game Studio Setup

This will:
  0. Install JavaScript dependencies (if needed)
  1. Build Soroban contracts
  2. Deploy to Stellar testnet
  3. Generate TypeScript bindings
  4. Write local testnet configuration

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1/4: Building contracts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ bun run scripts/build.ts
🔨 Building Soroban contracts...

Building mock-game-hub...
ℹ️  CARGO_BUILD_RUSTFLAGS=--remap-path-prefix=/home/shiv/.cargo/registry/src= cargo rustc --manifest-path=contracts/mock-game-hub/Cargo.toml --crate-type=cdylib --target=wasm32v1-none --release
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/mock-game-hub/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/my-game/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml: unused manifest key: workspace.version
    Finished `release` profile [optimized] target(s) in 0.18s
ℹ️  Build Summary:
    Wasm File: target/wasm32v1-none/release/mock_game_hub.wasm (2588 bytes)
    Wasm Hash: d7df0f5989c41e4bdbac32cfecf2bcafab0d02c6ba9a1f31fc07fb64ce32810a
    Wasm Size: 2588 bytes
    Exported Functions: 2 found
      • end_game
      • start_game
✅ Build Complete

✅ mock-game-hub built

Building my-game...
ℹ️  CARGO_BUILD_RUSTFLAGS=--remap-path-prefix=/home/shiv/.cargo/registry/src= cargo rustc --manifest-path=contracts/my-game/Cargo.toml --crate-type=cdylib --target=wasm32v1-none --release
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/mock-game-hub/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/contracts/my-game/Cargo.toml
workspace: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml
warning: /home/shiv/Codes/blockchain/piratetreasure/Stellar-Game-Studio/Cargo.toml: unused manifest key: workspace.version
    Finished `release` profile [optimized] target(s) in 0.05s
ℹ️  Build Summary:
    Wasm File: target/wasm32v1-none/release/my_game.wasm (13190 bytes)
    Wasm Hash: 900061fdb8c288686b3df8ded2e2179a792460a93baf0dddad77e1418bd74215
    Wasm Size: 13190 bytes
    Exported Functions: 14 found
      • __constructor
      • bury_treasure
      • create_room
      • dig
      • get_admin
      • get_game
      • get_hub
      • get_room
      • join_room
      • reveal_treasure
      • set_admin
      • set_hub
      • start_room
      • upgrade
✅ Build Complete

✅ my-game built

🎉 Contracts built successfully!

WASM files:
  - target/wasm32v1-none/release/mock_game_hub.wasm
  - target/wasm32v1-none/release/my_game.wasm

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 2/4: Deploying to testnet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ bun run scripts/deploy.ts
🚀 Deploying contracts to Stellar testnet...

Setting up admin identity...
📝 Generating new admin identity...
💰 Funding GBHARUSY2YLPNEFSVTFKM5AQ4VPRUQ3ANCIH7ZLQEBAVMWTA5QE6D5SB via friendbot...
✅ admin funded
⏳ Waiting for Soroban RPC to sync account (8s)…
Setting up player1...
✅ Using existing player1 from .env
✅ player1: GDPPQ2L23SON6P3T2MUVVNG4O4VXS5B46WRZVJI2XL3BU2WHOP3BN5B4
✅ player1 funded

Setting up player2...
✅ Using existing player2 from .env
✅ player2: GCVTQT7TDNU6WB5ATNFIG5J3R3ZEXNVHAQMP2VHDB6YEKFNVOTTKZ3XP
✅ player2 funded

🔐 Player secret keys will be saved to .env (gitignored)

💼 Wallet addresses:
  Admin:   GBHARUSY2YLPNEFSVTFKM5AQ4VPRUQ3ANCIH7ZLQEBAVMWTA5QE6D5SB
  Player1: GDPPQ2L23SON6P3T2MUVVNG4O4VXS5B46WRZVJI2XL3BU2WHOP3BN5B4
  Player2: GCVTQT7TDNU6WB5ATNFIG5J3R3ZEXNVHAQMP2VHDB6YEKFNVOTTKZ3XP

✅ Using pinned mock-game-hub on testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG

Deploying my-game...
  Uploading and deploying target/wasm32v1-none/release/my_game.wasm...
✅ my-game deployed: CB5ZUJBKWVMQ3A56VYVLK65NJD7P6CSONVIIUD6LZP3Y7ETCOSSPQ7MT

🎉 Deployment complete!

Contract IDs:
  mock-game-hub: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
  my-game: CB5ZUJBKWVMQ3A56VYVLK65NJD7P6CSONVIIUD6LZP3Y7ETCOSSPQ7MT

✅ Wrote deployment info to deployment.json
✅ Wrote secrets to .env (gitignored)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 3/4: Generating TypeScript bindings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ bun run scripts/bindings.ts
📦 Generating TypeScript bindings...

Generating bindings for mock-game-hub...
ℹ️  Network: Test SDF Network ; September 2015
🌎 Downloading contract spec: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
ℹ️  Embedding contract address: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
✅ Generated!
ℹ️  Run "npm install && npm run build" in "bindings/mock_game_hub" to build the JavaScript NPM package.
✅ mock-game-hub bindings generated

Generating bindings for my-game...
ℹ️  Network: Test SDF Network ; September 2015
🌎 Downloading contract spec: CB5ZUJBKWVMQ3A56VYVLK65NJD7P6CSONVIIUD6LZP3Y7ETCOSSPQ7MT
ℹ️  Embedding contract address: CB5ZUJBKWVMQ3A56VYVLK65NJD7P6CSONVIIUD6LZP3Y7ETCOSSPQ7MT
✅ Generated!
ℹ️  Run "npm install && npm run build" in "bindings/my_game" to build the JavaScript NPM package.
✅ my-game bindings generated

🎉 Bindings generated successfully!

Generated files:
  - bindings/mock_game_hub/
  - bindings/my_game/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 4/4: Writing local configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Root .env file created

🎉 Setup complete!

Contract IDs:
  mock-game-hub: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
  my-game: CB5ZUJBKWVMQ3A56VYVLK65NJD7P6CSONVIIUD6LZP3Y7ETCOSSPQ7MT

Next steps:
  bun run dev
shiv@Shiv:~/Codes/blockchain/piratetreasure/Stellar-Game-Studio$ 