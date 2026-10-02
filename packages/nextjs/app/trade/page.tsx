import { TradeView } from "./_components/TradeView";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Trade",
  description:
    "Open a leveraged HBAR-USD position with USDC or HBAR. Liquidations and funding are run by the Hedera network itself.",
});

const Trade: NextPage = () => (
  <div className="flex grow flex-col">
    <TradeView />
  </div>
);

export default Trade;
