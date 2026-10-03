// An audit log of the Custos keeper on the Hedera Consensus Service (HCS).
//
// Contracts can't write to HCS, so this runs off-chain and off the critical path: the keeper never depends on it.
// It reads PerpMarket's keeper events (Ticked, Swept, SweepSkipped, Liquidated, Refueled) from the mirror node and
// submits one compact JSON message per event to a topic only the operator can write to. Each message carries the
// event's consensus timestamp and transaction hash, so anyone can check it against HashScan or rebuild the whole log
// from the chain. Re-running is safe: it reads the last logged event back from the topic and starts after it.
//
//   yarn workspace @sh/foundry hcs-log --create   create the topic (once) and record it in deployments/296.json
//   yarn workspace @sh/foundry hcs-log            log every keeper event not yet on the topic
//   yarn workspace @sh/foundry hcs-log --dry-run  print what would be logged; needs no keys
//
// Operator (a Hedera testnet account; environment only, never a file): HEDERA_OPERATOR_ID=0.0.x and
// HEDERA_OPERATOR_KEY=<ECDSA private key, hex>. Topic: HCS_TOPIC_ID, else "hcsTopic" in deployments/296.json.
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = join(ROOT, "deployments", "296.json");
const MIRROR =
  process.env.HEDERA_MIRROR_URL || "https://testnet.mirrornode.hedera.com";
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CREATE = args.includes("--create");

const EVENTS = new ethers.utils.Interface([
  "event Ticked(uint256 indexed run, bool workOk, bytes reason)",
  "event Swept(uint256 from, uint256 to, uint256 liquidated)",
  "event SweepSkipped(uint8 status)",
  "event Liquidated(address indexed trader, uint256 price, bool byNetwork, address indexed by, uint256 reward)",
  "event Refueled(uint256 usdcIn, uint256 hbarOut, uint256 runsBefore)",
]);
const STATUS = ["Ok", "Stale", "Deviated"];

async function getJson(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${MIRROR}${path}`);
      if (!res.ok)
        throw new Error(`${res.status} ${res.statusText} for ${path}`);
      return await res.json();
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function loadDeployments() {
  return JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
}

function marketAddress(deployments) {
  const entry = Object.entries(deployments).find(
    ([, name]) => name === "PerpMarket"
  );
  if (!entry)
    throw new Error("No PerpMarket in deployments/296.json. Deploy first.");
  return entry[0];
}

/** Every keeper event of the market after `after` (consensus timestamp + log index), oldest first. */
async function keeperEvents(market, after) {
  const out = [];
  let path = `/api/v1/contracts/${market}/results/logs?order=asc&limit=100`;
  if (after) path += `&timestamp=gte:${after.ts}`;
  while (path) {
    const page = await getJson(path);
    for (const log of page.logs) {
      let parsed;
      try {
        parsed = EVENTS.parseLog({ topics: log.topics, data: log.data });
      } catch {
        continue; // not a keeper event
      }
      if (
        after &&
        (log.timestamp < after.ts ||
          (log.timestamp === after.ts && log.index <= after.i))
      )
        continue;
      out.push({ log, parsed });
    }
    path = page.links?.next || null;
  }
  return out;
}

/** One compact message per event. The run number comes from the Ticked event of the same transaction. */
function toMessages(events) {
  const runOfTx = new Map();
  for (const { log, parsed } of events) {
    if (parsed.name === "Ticked")
      runOfTx.set(log.transaction_hash, parsed.args.run.toString());
  }
  return events.map(({ log, parsed }) => {
    const m = {
      v: 1,
      e: parsed.name,
      ts: log.timestamp,
      i: log.index,
      tx: log.transaction_hash,
    };
    const run = runOfTx.get(log.transaction_hash);
    if (run) m.run = Number(run);
    const a = parsed.args;
    if (parsed.name === "Ticked") m.ok = a.workOk;
    if (parsed.name === "Swept") Object.assign(m, { from: a.from.toNumber(), to: a.to.toNumber(), liq: a.liquidated.toNumber() }); // prettier-ignore
    if (parsed.name === "SweepSkipped") m.status = STATUS[a.status] ?? a.status;
    if (parsed.name === "Liquidated") {
      Object.assign(m, {
        trader: a.trader,
        price: ethers.utils.formatUnits(a.price, 18),
        byNetwork: a.byNetwork,
        by: a.by,
        reward: ethers.utils.formatUnits(a.reward, 6),
      });
    }
    if (parsed.name === "Refueled") Object.assign(m, { usdcIn: ethers.utils.formatUnits(a.usdcIn, 6), hbarOut: ethers.utils.formatUnits(a.hbarOut, 8) }); // prettier-ignore
    return m;
  });
}

/** The last event the topic already holds, read back from the topic itself. */
async function lastLogged(topicId) {
  const page = await getJson(
    `/api/v1/topics/${topicId}/messages?order=desc&limit=25`
  );
  for (const msg of page.messages || []) {
    try {
      const m = JSON.parse(Buffer.from(msg.message, "base64").toString("utf8"));
      if (m.v === 1 && m.ts) return { ts: m.ts, i: m.i ?? 0 };
    } catch {
      // not one of ours (the topic memo message, or anything else): keep looking
    }
  }
  return null;
}

async function operatorClient() {
  const { Client, AccountId, PrivateKey } = await import("@hiero-ledger/sdk");
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !key) {
    throw new Error(
      "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (environment only), or use --dry-run."
    );
  }
  const privateKey = PrivateKey.fromStringECDSA(key.replace(/^0x/, ""));
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(id),
    privateKey
  );
  return { client, privateKey };
}

async function createTopic(market) {
  const { TopicCreateTransaction } = await import("@hiero-ledger/sdk");
  const { client, privateKey } = await operatorClient();
  const marketId = (await getJson(`/api/v1/contracts/${market}`)).contract_id;
  const tx = await new TopicCreateTransaction()
    .setTopicMemo(`Custos keeper audit log: PerpMarket ${marketId}`)
    .setSubmitKey(privateKey.publicKey)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId.toString();
  const deployments = loadDeployments();
  deployments.hcsTopic = topicId;
  writeFileSync(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");
  console.log(
    `✅ Topic ${topicId} created and recorded in deployments/296.json as "hcsTopic"`
  );
  console.log(`   https://hashscan.io/testnet/topic/${topicId}`);
  client.close();
  return topicId;
}

async function main() {
  const deployments = loadDeployments();
  const market = marketAddress(deployments);
  let topicId = process.env.HCS_TOPIC_ID || deployments.hcsTopic;
  if (CREATE) {
    if (topicId)
      throw new Error(
        `A topic is already recorded (${topicId}). Remove it to create another.`
      );
    topicId = await createTopic(market);
  }
  if (!topicId && !DRY_RUN)
    throw new Error("No topic. Run with --create first, or set HCS_TOPIC_ID.");

  const after = topicId ? await lastLogged(topicId) : null;
  const messages = toMessages(await keeperEvents(market, after));
  console.log(`Topic ${topicId ?? "(none yet)"}: last logged ${after ? `${after.ts} #${after.i}` : "nothing"}; ${messages.length} new event(s)`); // prettier-ignore
  if (messages.length === 0) return;

  if (DRY_RUN) {
    for (const m of messages) console.log(JSON.stringify(m));
    return;
  }
  const { TopicMessageSubmitTransaction } = await import("@hiero-ledger/sdk");
  const { client } = await operatorClient();
  for (const m of messages) {
    const tx = await new TopicMessageSubmitTransaction({ topicId, message: JSON.stringify(m) }).execute(client); // prettier-ignore
    const receipt = await tx.getReceipt(client);
    console.log(
      `#${receipt.topicSequenceNumber} ${m.e}${m.run ? ` run ${m.run}` : ""} ${
        m.ts
      }`
    );
  }
  client.close();
  console.log(
    `✅ Logged ${messages.length} event(s): https://hashscan.io/testnet/topic/${topicId}`
  );
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
