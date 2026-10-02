/**
 * Proof that this template's reference deployment runs on Hedera testnet.
 * Source of truth: packages/foundry/TESTNET.md. When you deploy your own copy, replace these with your ids.
 */
const HASHSCAN = "https://hashscan.io/testnet";

export const TESTNET_NOTES_URL =
  "https://github.com/victorjayeoba/scaffold-hbar-custos/blob/main/packages/foundry/TESTNET.md";

export type ProofRow = { label: string; id: string; href: string };

export const testnetProof: ProofRow[] = [
  {
    label: "PerpMarket: the HBAR-USD market and its keeper",
    id: "0.0.10776702",
    href: `${HASHSCAN}/contract/0.0.10776702`,
  },
  {
    label: "LiquidityPool: USDC in, cUSDC-LP shares out",
    id: "0.0.10776700",
    href: `${HASHSCAN}/contract/0.0.10776700`,
  },
  {
    label: "PriceGuard: Chainlink checked against Supra",
    id: "0.0.10776695",
    href: `${HASHSCAN}/contract/0.0.10776695`,
  },
  {
    label: "First check, run by the network at the second it was booked",
    id: "1790687748.000592261",
    href: `${HASHSCAN}/transaction/1790687748.000592261`,
  },
  {
    label: "First liquidation, run by the network with no one signing: a 50x long closed at 0.11304",
    id: "1790691346.057913123",
    href: `${HASHSCAN}/transaction/1790691346.057913123`,
  },
  {
    label: "The schedule that fired the first check, booked by the contract itself",
    id: "0.0.10776713",
    href: `${HASHSCAN}/schedule/0.0.10776713`,
  },
];
