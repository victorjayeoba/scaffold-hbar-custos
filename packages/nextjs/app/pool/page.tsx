import { PoolView } from "./_components/PoolView";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Pool",
  description:
    "Deposit USDC into the Custos liquidity pool and take the other side of every HBAR-USD trade. Fees, liquidations and trader losses flow in; trader profits and keeper fees flow out.",
});

const Pool: NextPage = () => <PoolView />;

export default Pool;
