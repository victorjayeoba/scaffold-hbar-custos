import { wagmiConnectors } from "./wagmiConnectors";
import { createClient, fallback, http } from "viem";
import { createConfig } from "wagmi";
import scaffoldConfig, { ScaffoldConfig } from "~~/scaffold.config";

const { targetNetworks } = scaffoldConfig;

export const enabledChains = targetNetworks;

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: wagmiConnectors(),
  ssr: true,
  client({ chain }) {
    const rpcFallbacks = [];

    const rpcOverrideUrl = (scaffoldConfig.rpcOverrides as ScaffoldConfig["rpcOverrides"])?.[chain.id];
    if (rpcOverrideUrl) {
      // Batch reads into few HTTP requests: public relays rate-limit bursts.
      // thirdweb rejects batches over 25 calls (413), so stay under it.
      rpcFallbacks.push(http(rpcOverrideUrl, { batch: { batchSize: 20 } }));
    }

    // Default public RPC for the chain (e.g. Hedera testnet hashio)
    rpcFallbacks.push(http());

    return createClient({
      chain,
      transport: fallback(rpcFallbacks),
      pollingInterval: scaffoldConfig.pollingInterval,
    });
  },
});
