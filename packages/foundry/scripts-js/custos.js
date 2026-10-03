// Custos on Hedera testnet, with `forge create` and `cast send` only. `forge script` cannot simulate Hedera's
// system contracts (HSS, HTS), and current Foundry cannot fork through the public JSON-RPC relay.
//
//   yarn custos:deploy:testnet   PriceGuard → LiquidityPool → PerpMarket, link them, fund the keeper, then
//                                HbarDepositZap (HBAR-USD only); write deployments/296.json and regenerate the
//                                frontend's deployedContracts.ts
//   yarn custos:start:testnet    associate pool, market and zap with USDC, book the keeper's first tick
//   yarn custos:demo:testnet     swap HBAR to USDC on SaucerSwap and seed the pool, then open a 50x long with
//                                HBAR alone (openWithHbar) that a ~1% drop liquidates
//   yarn custos:revive:testnet   restart the keeper if its chain broke
//   yarn workspace @sh/foundry custos zap
//                                deploy HbarDepositZap next to the live pool (LPs deposit with HBAR via SaucerSwap),
//                                associate it with USDC and regenerate the frontend's ABIs
//   yarn custos:check-market:testnet --market <NAME>
//                                deploy only a PriceGuard for that market and read both live feeds; exits 1 if
//                                either feed doesn't answer (the quickest way to vet a new market's config)
//
// Markets live in markets.json (Chainlink feed, Supra pair, staleness, deviation). --market <NAME> picks one for
// deploy/start/demo/revive/check-market; the default is HBAR-USD, which is what the frontend reads. Any other
// market's addresses go to deployments/296-<name>.json and leave the frontend's deployedContracts.ts alone.
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
const MARKETS = JSON.parse(readFileSync(join(ROOT, "markets.json"), "utf8"));
const DEFAULT_MARKET = "HBAR-USD";
// SaucerSwap testnet: the USDC its pools trade (0.0.5449), the V1 router (0.0.19264) and the WHBAR token (0.0.15058).
// On mainnet: Circle USDC 0.0.456858, router 0.0.3045981, WHBAR 0.0.1456986.
const USDC = "0x0000000000000000000000000000000000001549";
const ROUTER = "0x0000000000000000000000000000000000004b40";
const WHBAR = "0x0000000000000000000000000000000000003aD2";
const marketFlag = process.argv.indexOf("--market");
const MARKET = marketFlag >= 0 ? process.argv[marketFlag + 1] : DEFAULT_MARKET;
const IS_DEFAULT_MARKET = MARKET === DEFAULT_MARKET;
const DEPLOYMENTS = join(
  ROOT,
  "deployments",
  IS_DEFAULT_MARKET ? "296.json" : `296-${MARKET.toLowerCase()}.json`
);
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

function create(name, args, dir = "contracts") {
  const out = run(
    `Deploy ${name}`,
    "forge",
    [
      "create", `${dir}/${name}.sol:${name}`, "--rpc-url", RPC, ...signer(),
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

/// Writes the deployments file. For the default market it also writes a broadcast record in forge's format and
/// regenerates the frontend's ABIs.
function record(contracts) {
  mkdirSync(dirname(DEPLOYMENTS), { recursive: true });
  const json = { networkName: "hedera_testnet", market: MARKET };
  for (const c of contracts) json[c.address] = c.name;
  writeFileSync(DEPLOYMENTS, JSON.stringify(json, null, 2) + "\n");
  if (!IS_DEFAULT_MARKET) return;

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
  if (
    !["deploy", "start", "demo", "revive", "check-market", "zap"].includes(
      command
    )
  ) {
    console.log(
      "Usage: node scripts-js/custos.js <deploy|start|demo|revive|check-market|zap> [--market <NAME>] [--keystore <name>]"
    );
    process.exit(1);
  }
  const m = MARKETS[MARKET];
  if (!m) {
    console.error(`❌ No market "${MARKET}" in markets.json. Known: ${Object.keys(MARKETS).join(", ")}`); // prettier-ignore
    process.exit(1);
  }
  const guardArgs = (owner) => [
    m.chainlink, m.supra, String(m.supraPair), String(m.maxStaleness), String(m.maxDeviationBps), owner,
  ]; // prettier-ignore
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
    console.log(`\nMarket: ${MARKET}`);
    const guard = create("PriceGuard", guardArgs(owner));
    const pool = create("LiquidityPool", [USDC, owner]);
    const market = create("PerpMarket", [
      USDC, guard.address, pool.address, owner, interval, gasLimit, gasPrice, ROUTER, WHBAR, minCollateral,
      maxSwapDeviation,
    ]); // prettier-ignore
    send("Link the pool to the market", pool.address, "setMarket(address)", [market.address]); // prettier-ignore
    send("Create the pool's HTS share token (cUSDC-LP)", pool.address, "createShareToken()", [], 3_000_000, `${shareTokenFee}ether`); // prettier-ignore
    send("Fund the keeper's fee reserve", market.address, "fund()", [], 100_000, `${fund}ether`); // prettier-ignore
    // The zap's oracle floor prices HBAR with this guard, so it only makes sense on the HBAR-USD market.
    const zap = IS_DEFAULT_MARKET && create("HbarDepositZap", [pool.address, guard.address, ROUTER, WHBAR, maxSwapDeviation], "contracts/periphery"); // prettier-ignore
    record([guard, pool, market, ...(zap ? [zap] : [])]);
    console.log("\nNext: yarn custos:start:testnet");
  }

  if (command === "check-market") {
    run("Compile", "forge", ["build"]);
    const guard = create("PriceGuard", guardArgs(deployer()));
    const out = run("Read both feeds", "cast", ["call", guard.address, "prices()(uint256,uint256,uint8)", "--rpc-url", RPC], true); // prettier-ignore
    const [chainlinkPrice, supraPrice, status] = out.trim().split("\n").map((l) => l.trim().split(" ")[0]); // prettier-ignore
    const names = ["Ok", "Stale", "Deviated"];
    console.log(`\n${MARKET}: Chainlink ${Number(chainlinkPrice) / 1e18}, Supra ${Number(supraPrice) / 1e18}, status ${names[Number(status)]}`); // prettier-ignore
    console.log(
      `PriceGuard: https://hashscan.io/testnet/contract/${guard.address}`
    );
    if (chainlinkPrice === "0" || supraPrice === "0") {
      console.error("❌ A feed did not answer: check the Chainlink address and the Supra pair in markets.json"); // prettier-ignore
      process.exit(1);
    }
    console.log("✅ Both feeds answer");
    return;
  }

  const { PerpMarket: market, LiquidityPool: pool } = deployed();

  if (command === "zap") {
    const { PriceGuard: guardAddress } = deployed();
    const maxSwapDeviation = process.env.MAX_SWAP_DEVIATION_BPS || "300";
    run("Compile", "forge", ["build"]);
    const zap = create("HbarDepositZap", [pool, guardAddress, ROUTER, WHBAR, maxSwapDeviation], "contracts/periphery"); // prettier-ignore
    send("Associate the zap with USDC", zap.address, "associate()");
    // keep the earlier contracts in the record so the frontend's ABIs list all of them
    const latest = join(
      ROOT,
      "broadcast",
      "Deploy.s.sol",
      "296",
      "run-latest.json"
    );
    const earlier = existsSync(latest)
      ? JSON.parse(readFileSync(latest, "utf8")).transactions.map((t) => ({
          name: t.contractName,
          address: t.contractAddress,
          hash: t.hash,
        }))
      : [];
    record([...earlier.filter((c) => c.name !== "HbarDepositZap"), zap]);
    console.log(
      `\nHbarDepositZap: https://hashscan.io/testnet/contract/${zap.address}`
    );
    return;
  }

  if (command === "start") {
    send("Associate the pool with USDC", pool, "associate()");
    send("Associate the market with USDC", market, "associate()");
    const { HbarDepositZap: zap } = deployed();
    if (zap) send("Associate the HbarDepositZap with USDC", zap, "associate()");
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
