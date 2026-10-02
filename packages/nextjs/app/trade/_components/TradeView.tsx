"use client";

import { MarketHeader } from "./MarketHeader";
import { MarketPositions } from "./MarketPositions";
import { TradeOpenForm } from "./TradeOpenForm";
import { TradePositionCard } from "./TradePositionCard";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useHtsToken } from "~~/hooks/custos/useHtsToken";
import { useNow } from "~~/hooks/custos/useNow";
import { useTradeMarket } from "~~/hooks/custos/useTradeMarket";
import { useTradePosition } from "~~/hooks/custos/useTradePosition";
import { useDeployedContractInfo } from "~~/hooks/scaffold-hbar";

/** The /trade page body: reads are made once here and shared, so every panel shows the same numbers. */
export const TradeView = () => {
  const now = useNow();
  const { address } = useAccount();
  const market = useTradeMarket();
  const { data: perp } = useDeployedContractInfo({ contractName: "PerpMarket" });
  const usdc = useHtsToken({ token: market.usdc, owner: address, spender: perp?.address });
  const position = useTradePosition(address);
  const connect = <RainbowKitCustomConnectButton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-5">
      <div>
        <h1 className="m-0 text-[clamp(2rem,4vw,3rem)] font-normal tracking-[-0.01em]">Trade HBAR-USD</h1>
        <p className="mt-2 mb-0 max-w-2xl text-base-content/70">
          Long or short HBAR with up to {market.params ? `${market.params.maxLeverage.toString()}x` : "50x"} leverage,
          settled in USDC. Liquidations and funding are run by the Hedera network on a schedule, never by a bot.
        </p>
      </div>

      <MarketHeader market={market} now={now} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <TradeOpenForm
          market={market}
          usdc={usdc}
          account={address}
          hasPosition={position.hasPosition}
          connectButton={connect}
          now={now}
        />
        <TradePositionCard
          market={market}
          usdc={usdc}
          account={address}
          position={position}
          now={now}
          connectButton={connect}
        />
      </div>

      <MarketPositions market={market} me={address} />
    </div>
  );
};
