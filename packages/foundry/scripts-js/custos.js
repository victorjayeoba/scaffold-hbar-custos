// Custos testnet actions that need Hedera's system contracts (HSS, HTS), which `forge script` cannot simulate.
// Each step is a plain `cast send` from your keystore, so every transaction shows up on HashScan as you.
//
//   yarn custos:start:testnet    associate pool + market with USDC, book the keeper's first tick
//   yarn custos:demo:testnet     seed the pool and open a 50x long that a ~1% drop liquidates
//   yarn custos:revive:testnet   restart the keeper if its chain broke
//
// Options: --keystore <name> (or ETH_KEYSTORE_ACCOUNT); cast reads ETH_PASSWORD if set, else prompts.
// Demo amounts (USDC, 6 dp): DEMO_POOL_USDC (default 100000000 = 100), DEMO_COLLATERAL (default 1000000 = 1).
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { listKeystores } from "./listKeystores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const USDC = "0x0000000000000000000000000000000000068cDa";

const [, , command, ...rest] = process.argv;
const keystoreFlag = rest.indexOf("--keystore");
let keystore =
  keystoreFlag >= 0 ? rest[keystoreFlag + 1] : process.env.ETH_KEYSTORE_ACCOUNT;

function deployed() {
  const file = join(__dirname, "..", "deployments", "296.json");
  if (!existsSync(file)) {
    console.error(
      "❌ No deployments/296.json. Run `yarn foundry:deploy:testnet` first."
    );
    process.exit(1);
  }
  const byName = {};
  for (const [addr, name] of Object.entries(
    JSON.parse(readFileSync(file, "utf8"))
  )) {
    if (addr.startsWith("0x")) byName[name] = addr;
  }
  return byName;
}

function send(label, to, sig, args = [], gas = 1_000_000) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(
    "cast",
    [
      "send",
      to,
      sig,
      ...args,
      "--rpc-url",
      RPC,
      "--account",
      keystore,
      "--legacy",
      "--gas-limit",
      String(gas),
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (result.status !== 0) {
    console.error(`❌ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

async function main() {
  if (!["start", "demo", "revive"].includes(command)) {
    console.log(
      "Usage: node scripts-js/custos.js <start|demo|revive> [--keystore <name>]"
    );
    process.exit(1);
  }
  if (!keystore)
    keystore = await listKeystores("Select the keystore to send from: ");
  const { PerpMarket: market, LiquidityPool: pool } = deployed();

  if (command === "start") {
    send("Associate the pool with USDC", pool, "associate()");
    send("Associate the market with USDC", market, "associate()");
    send("Book the keeper's first tick", market, "revive()", [], 1_500_000);
  }

  if (command === "demo") {
    const poolUsdc = process.env.DEMO_POOL_USDC || "100000000";
    const collateral = process.env.DEMO_COLLATERAL || "1000000";
    send("Approve the pool to take USDC", USDC, "approve(address,uint256)", [
      pool,
      poolUsdc,
    ]);
    send("Deposit into the pool", pool, "deposit(uint256,address)", [
      poolUsdc,
      deployer(),
    ]);
    send(
      "Approve the market to take collateral",
      USDC,
      "approve(address,uint256)",
      [market, collateral]
    );
    send(
      "Open a 50x long",
      market,
      "open(bool,uint256,uint256)",
      ["true", collateral, "50"],
      1_500_000
    );
  }

  if (command === "revive") {
    send("Revive the keeper", market, "revive()", [], 1_500_000);
  }

  console.log(
    `\n✅ Done. Market: https://hashscan.io/testnet/contract/${market}`
  );
}

function deployer() {
  const result = spawnSync(
    "cast",
    ["wallet", "address", "--account", keystore],
    {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
      shell: process.platform === "win32",
    }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
