// Custos on Hedera testnet, with `forge create` and `cast send` only. `forge script` cannot simulate Hedera's
// system contracts (HSS, HTS), and current Foundry cannot fork through the public JSON-RPC relay.
//
//   yarn custos:deploy:testnet   PriceGuard → LiquidityPool → PerpMarket, link them, fund the keeper,
//                                write deployments/296.json and regenerate the frontend's deployedContracts.ts
//   yarn custos:start:testnet    associate pool + market with USDC, book the keeper's first tick
//   yarn custos:demo:testnet     swap HBAR to USDC on SaucerSwap and seed the pool, then open a 50x long with
//                                HBAR alone (openWithHbar) that a ~1% drop liquidates
//   yarn custos:revive:testnet   restart the keeper if its chain broke
//
// Signer: --keystore <name> (or ETH_KEYSTORE_ACCOUNT; cast reads ETH_PASSWORD if set, else prompts),
//         or DEPLOYER_PRIVATE_KEY in the environment (never write it into a file).
// Keeper (deploy): KEEPER_INTERVAL s (default 1800), KEEPER_GAS_LIMIT (default 3000000),
//                  KEEPER_GAS_PRICE tinybars per gas (default 82; each network tick then records the real one),
//                  KEEPER_FUND HBAR (default 40). Hedera holds a run's whole gas limit up front, so one run needs
//                  KEEPER_GAS_LIMIT x gas price in the reserve: 3,000,000 x 82 tinybars = 2.46 HBAR.
// Market (deploy): MIN_COLLATERAL USDC units (default 1000000 = 1 USDC), MAX_SWAP_DEVIATION_BPS (default 300: the
//                  keeper's refuel swap must fill within 3% of the oracle price). SaucerSwap testnet's USDC pool trades
//                  ~22x off the oracle, so on testnet refuels fail closed and the reserve is topped up with `fund()`;
//                  a wide band would let every refuel overpay ~22x out of LP money.
//                  SHARE_TOKEN_FEE HBAR sent to create the HTS LP token (default 30; the unused part comes back).
// Demo (HBAR): DEMO_POOL_HBAR swapped to USDC for the pool (default 120), DEMO_TRADE_HBAR per position (default 1).
//              A 50x position needs the pool to hold twice its notional (open interest is capped at half the pool).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { listKeystores } from "./listKeystores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RPC = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const CHAINLINK_HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const SUPRA = "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";
const SUPRA_HBAR_USDT = "75";
// SaucerSwap testnet: the USDC its pools trade (0.0.5449), the V1 router (0.0.19264) and the WHBAR token (0.0.15058).
// On mainnet: Circle USDC 0.0.456858, router 0.0.3045981, WHBAR 0.0.1456986.
const USDC = "0x0000000000000000000000000000000000001549";
const ROUTER = "0x0000000000000000000000000000000000004b40";
const WHBAR = "0x0000000000000000000000000000000000003aD2";
const DEPLOYMENTS = join(ROOT, "deployments", "296.json");
const shell = process.platform === "win32";

const [, , command, ...rest] = process.argv;
const keystoreFlag = rest.indexOf("--keystore");
let keystore =
  keystoreFlag >= 0 ? rest[keystoreFlag + 1] : process.env.ETH_KEYSTORE_ACCOUNT;

function signer() {
  return process.env.DEPLOYER_PRIVATE_KEY
    ? ["--private-key", process.env.DEPLOYER_PRIVATE_KEY]
    : ["--account", keystore];
}

function run(label, bin, args, capture = false) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    shell,
  });
  if (result.status !== 0) {
    console.error(`❌ ${label} failed`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function send(label, to, sig, args = [], gas = 1_000_000, value) {
  const extra = value ? ["--value", value] : [];
  run(label, "cast", [
    "send", to, sig, ...args, ...extra,
    "--rpc-url", RPC, ...signer(), "--legacy", "--gas-limit", String(gas),
  ]); // prettier-ignore
}

function create(name, args) {
  const out = run(
    `Deploy ${name}`,
    "forge",
    [
      "create", `contracts/${name}.sol:${name}`, "--rpc-url", RPC, ...signer(),
      "--legacy", "--broadcast", "--json", "--constructor-args", ...args,
    ], // prettier-ignore
    true
  );
  const { deployedTo, transactionHash } = JSON.parse(
    out.slice(out.indexOf("{"))
  );
  console.log(`  ${name} ${deployedTo}`);
  return { name, address: deployedTo, hash: transactionHash };
}

function deployer() {
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    return run("Deployer address", "cast", ["wallet", "address", ...signer()], true).trim(); // prettier-ignore
  }
  return run("Deployer address", "cast", ["wallet", "address", "--account", keystore], true).trim(); // prettier-ignore
}

function call(to, sig, args = []) {
  return run(`Read ${sig.split("(")[0]}`, "cast", ["call", to, sig, ...args, "--rpc-url", RPC], true) // prettier-ignore
    .trim()
    .split(" ")[0];
}

function deployed() {
  if (!existsSync(DEPLOYMENTS)) {
    console.error("❌ No deployments/296.json. Run `yarn custos:deploy:testnet` first."); // prettier-ignore
    process.exit(1);
  }
  const byName = {};
  for (const [addr, name] of Object.entries(
    JSON.parse(readFileSync(DEPLOYMENTS, "utf8"))
  )) {
    if (addr.startsWith("0x")) byName[name] = addr;
  }
  return byName;
}

/// Writes deployments/296.json and a broadcast record in forge's format, then regenerates the ABIs.
function record(contracts) {
  mkdirSync(dirname(DEPLOYMENTS), { recursive: true });
  const json = { networkName: "hedera_testnet" };
  for (const c of contracts) json[c.address] = c.name;
  writeFileSync(DEPLOYMENTS, JSON.stringify(json, null, 2) + "\n");

  const dir = join(ROOT, "broadcast", "Deploy.s.sol", "296");
  mkdirSync(dir, { recursive: true });
  const transactions = contracts.map((c) => ({
    hash: c.hash,
    transactionType: "CREATE",
    contractName: c.name,
    contractAddress: c.address,
  }));
  const receipts = contracts.map((c) => ({ transactionHash: c.hash }));
  const body = JSON.stringify({ transactions, receipts, chain: 296 }, null, 2);
  writeFileSync(join(dir, `run-${Math.floor(Date.now() / 1000)}.json`), body);
  writeFileSync(join(dir, "run-latest.json"), body);
  run("Generate the frontend ABIs", "node", ["scripts-js/generateTsAbis.js"]);
}

async function main() {
  if (!["deploy", "start", "demo", "revive"].includes(command)) {
    console.log(
      "Usage: node scripts-js/custos.js <deploy|start|demo|revive> [--keystore <name>]"
    );
    process.exit(1);
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY && !keystore) {
    keystore = await listKeystores("Select the keystore to send from: ");
  }

  if (command === "deploy") {
    const owner = deployer();
    const interval = process.env.KEEPER_INTERVAL || "1800";
    const gasLimit = process.env.KEEPER_GAS_LIMIT || "3000000";
    const gasPrice = process.env.KEEPER_GAS_PRICE || "82";
    const fund = process.env.KEEPER_FUND || "40";
    const minCollateral = process.env.MIN_COLLATERAL || "1000000";
    const maxSwapDeviation = process.env.MAX_SWAP_DEVIATION_BPS || "300";
    const shareTokenFee = process.env.SHARE_TOKEN_FEE || "30";
    run("Compile", "forge", ["build"]);
    const guard = create("PriceGuard", [
      CHAINLINK_HBAR_USD, SUPRA, SUPRA_HBAR_USDT, "7200", "500", owner,
    ]); // prettier-ignore
    const pool = create("LiquidityPool", [USDC, owner]);
    const market = create("PerpMarket", [
      USDC, guard.address, pool.address, owner, interval, gasLimit, gasPrice, ROUTER, WHBAR, minCollateral,
      maxSwapDeviation,
    ]); // prettier-ignore
    send("Link the pool to the market", pool.address, "setMarket(address)", [market.address]); // prettier-ignore
    send("Create the pool's HTS share token (cUSDC-LP)", pool.address, "createShareToken()", [], 3_000_000, `${shareTokenFee}ether`); // prettier-ignore
    send("Fund the keeper's fee reserve", market.address, "fund()", [], 100_000, `${fund}ether`); // prettier-ignore
    record([guard, pool, market]);
    console.log("\nNext: yarn custos:start:testnet");
  }

  const { PerpMarket: market, LiquidityPool: pool } = deployed();

  if (command === "start") {
    send("Associate the pool with USDC", pool, "associate()");
    send("Associate the market with USDC", market, "associate()");
    send("Book the keeper's first tick", market, "revive()", [], 2_500_000);
  }

  if (command === "demo") {
    const me = deployer();
    const poolHbar = process.env.DEMO_POOL_HBAR || "120";
    const tradeHbar = process.env.DEMO_TRADE_HBAR || "1";
    send(
      "Associate your account with USDC (a no-op if already done)",
      USDC,
      "associate()"
    );
    const before = BigInt(call(USDC, "balanceOf(address)(uint256)", [me]));
    send(`Swap ${poolHbar} HBAR to USDC on SaucerSwap`, ROUTER, "swapExactETHForTokens(uint256,address[],address,uint256)", ["0", `[${WHBAR},${USDC}]`, me, String(Math.floor(Date.now() / 1000) + 600)], 1_500_000, `${poolHbar}ether`); // prettier-ignore
    const got = (BigInt(call(USDC, "balanceOf(address)(uint256)", [me])) - before).toString(); // prettier-ignore
    const shareToken = call(pool, "shareToken()(address)");
    send("Associate your account with the pool's share token (cUSDC-LP)", shareToken, "associate()"); // prettier-ignore
    send("Approve the pool to take that USDC", USDC, "approve(address,uint256)", [pool, got]); // prettier-ignore
    send(`Deposit ${Number(got) / 1e6} USDC into the pool`, pool, "deposit(uint256,address)", [got, me], 2_000_000); // prettier-ignore
    const tinybars = String(Math.round(Number(tradeHbar) * 1e8));
    const quote = BigInt(call(market, "quoteHbarToUsdc(uint256)(uint256)", [tinybars])); // prettier-ignore
    const min = ((quote * 99n) / 100n).toString();
    send(`Open a 50x long with ${tradeHbar} HBAR (SaucerSwap swaps it to collateral)`, market, "openWithHbar(bool,uint256,uint256)", ["true", "50", min], 3_000_000, `${tradeHbar}ether`); // prettier-ignore
  }

  if (command === "revive") {
    send("Revive the keeper", market, "revive()", [], 2_500_000);
  }

  console.log(
    `\n✅ Done. Market: https://hashscan.io/testnet/contract/${market}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
