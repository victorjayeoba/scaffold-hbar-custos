/**
 * Proof that this template's reference deployment runs on Hedera testnet (deploy of 2026-10-02, contracts 191a5c0).
 * Every id below was checked on the mirror node. When you deploy your own copy, replace these with your ids.
 * HashScan opens a transaction by its EVM hash as well as by its consensus timestamp.
 */
const HASHSCAN = "https://hashscan.io/testnet";

export const TESTNET_NOTES_URL =
  "https://github.com/victorjayeoba/scaffold-hbar-custos/blob/main/packages/foundry/TESTNET.md";

export type ProofRow = { label: string; id: string; href: string };

const tx = (label: string, hash: string): ProofRow => ({ label, id: hash, href: `${HASHSCAN}/transaction/${hash}` });

export const testnetProof: ProofRow[] = [
  {
    label: "PerpMarket: the HBAR-USD market and its keeper",
    id: "0.0.10833087",
    href: `${HASHSCAN}/contract/0.0.10833087`,
  },
  {
    label: "LiquidityPool: takes USDC, mints and burns the LP share token",
    id: "0.0.10833082",
    href: `${HASHSCAN}/contract/0.0.10833082`,
  },
  {
    label: "cUSDC-LP: the LP share, a native HTS token the pool created",
    id: "0.0.10833090",
    href: `${HASHSCAN}/token/0.0.10833090`,
  },
  {
    label: "PriceGuard: Chainlink checked against Supra",
    id: "0.0.10833074",
    href: `${HASHSCAN}/contract/0.0.10833074`,
  },
  {
    label: "The first check, booked on the Schedule Service by the contract itself",
    id: "0.0.10833097",
    href: `${HASHSCAN}/schedule/0.0.10833097`,
  },
  tx(
    "Keeper started: revive() books the first check",
    "0xa1b7d249013f1f2812b4176ccc234f54fc0a2f0dc48270cd7f2bdd26e8fa1b71",
  ),
  tx("The pool creates its HTS share token", "0xf405eadedf1ddd1e99b615a619ae451d0f5b78dd049fb8bfb84189e681340a5a"),
  tx(
    "Deposit 361.79 USDC: the pool mints cUSDC-LP",
    "0x55d081b26535e7c9ef68664a080f0609a7caacab03becc115ee7180e1154d722",
  ),
  tx(
    "Open a 50x long with HBAR only: SaucerSwap swaps it to USDC collateral",
    "0x62868b097e839fdeeef472c7fd8ff26f58a3ddd410924b825f2855d75e3986e7",
  ),
  tx("Open a 50x short with 1.2 USDC", "0xfac6b7ecccee1f124fd9eb56be2f9657a8457dee24ccef923c2f434abbb7bdba"),
  tx("Open a 2x long with 1 USDC", "0xd3f325cf8191e5e197b9af1f45a9ab90173079181724f9f331bb603726443de8"),
  tx(
    "Redeem 10 cUSDC-LP: the pool burns the shares and pays USDC",
    "0x9048724259694f86a20fa69aa069a89d3e85045703b0a6f1a9b302d66c2d7422",
  ),
  tx(
    "First check, run by the network at the second it was booked: no one signed it",
    "0x5bebf1d891890489514a052be62988357a00dc621b9fa19a6fe09f80de0038f6",
  ),
  // TODO: add the first network-run liquidation on this deploy (Liquidated with byNetwork = true) once it has
  // happened. Take the tx from the mirror node; never guess.
];
