import { useTheme } from "next-themes";
import { BaseError, UserRejectedRequestError } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/solid";
import { getNetworkColor } from "~~/hooks/scaffold-hbar";
import { getTargetNetworks, notification } from "~~/utils/scaffold-hbar";

const allowedNetworks = getTargetNetworks();

type NetworkOptionsProps = {
  hidden?: boolean;
};

export const NetworkOptions = ({ hidden = false }: NetworkOptionsProps) => {
  const { switchChain } = useSwitchChain();
  const { chain } = useAccount();
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";

  return (
    <>
      {allowedNetworks
        .filter(allowedNetwork => allowedNetwork.id !== chain?.id)
        .map(allowedNetwork => (
          <li key={allowedNetwork.id} className={hidden ? "hidden" : ""}>
            <button
              className="menu-item btn-sm rounded-xl! flex gap-3 py-3 whitespace-nowrap"
              type="button"
              onClick={() => {
                switchChain?.(
                  { chainId: allowedNetwork.id },
                  {
                    // WalletConnect wallets (HashPack, Kabila) only switch to networks they approved when pairing.
                    onError: error =>
                      notification.error(
                        error instanceof BaseError && error.walk(e => e instanceof UserRejectedRequestError)
                          ? "You cancelled the network switch in your wallet."
                          : `Your wallet couldn't switch to ${allowedNetwork.name}. Switch network in the wallet itself, then disconnect and connect again.`,
                      ),
                  },
                );
              }}
            >
              <ArrowsRightLeftIcon className="h-6 w-4 ml-2 sm:ml-0" />
              <span>
                Switch to{" "}
                <span
                  style={{
                    color: getNetworkColor(allowedNetwork, isDarkMode),
                  }}
                >
                  {allowedNetwork.name}
                </span>
              </span>
            </button>
          </li>
        ))}
    </>
  );
};
