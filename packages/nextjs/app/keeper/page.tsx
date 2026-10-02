import { KeeperActivity } from "./_components/KeeperActivity";
import { KeeperHeartbeat } from "./_components/KeeperHeartbeat";
import { KeeperOracle } from "./_components/KeeperOracle";
import { KeeperReserve } from "./_components/KeeperReserve";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Keeper",
  description:
    "Pull the plug: Hedera keeps the books. Live heartbeat, fee reserve and network-run liquidations of the Custos keeper.",
});

const Keeper: NextPage = () => (
  <div className="flex grow flex-col">
    <KeeperHeartbeat />
    <KeeperReserve />
    <KeeperOracle />
    <KeeperActivity />
  </div>
);

export default Keeper;
