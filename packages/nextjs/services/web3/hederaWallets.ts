import { type Wallet, getWalletConnectConnector } from "@rainbow-me/rainbowkit";
import type { RainbowKitWalletConnectParameters } from "@rainbow-me/rainbowkit";

/**
 * HashPack and Kabila as RainbowKit wallets.
 *
 * Both speak WalletConnect's `eip155` namespace on Hedera (eip155:296 testnet, eip155:295 mainnet), so they sit on
 * wagmi's own WalletConnect connector and every wagmi write in the app signs through them unchanged.
 *
 * Their browser extensions don't inject a provider. They pair over WalletConnect too: the page asks which Hedera
 * extensions are installed with a window message, then hands the chosen one the pairing URI. That is the handshake
 * @hashgraph/hedera-wallet-connect uses (shared/extensionController), done here in a few lines instead of a new
 * dependency. Without the extension the same pairing URI shows as a QR code for the phone app.
 *
 * Only ECDSA accounts can sign EVM transactions; an ED25519 account has no EVM address to sign with.
 */

type ExtensionMetadata = { id: string; name?: string };

const QUERY = "hedera-extension-query";
const RESPONSE = "hedera-extension-response";
const CONNECT = "hedera-extension-connect-";

/** Asks the installed Hedera extensions to announce themselves and resolves with the first whose name matches. */
const findExtension = (name: RegExp, timeoutMs = 800) =>
  new Promise<ExtensionMetadata | undefined>(resolve => {
    const onMessage = (event: MessageEvent) => {
      const metadata =
        event.data?.type === RESPONSE ? (event.data.metadata as ExtensionMetadata | undefined) : undefined;
      if (event.source !== window || !metadata?.id || !name.test(metadata.name ?? "")) return;
      done(metadata);
    };
    const done = (found?: ExtensionMetadata) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(found);
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ type: QUERY }, window.location.origin);
  });

/** Hands a WalletConnect pairing URI to the wallet's browser extension, if it is installed. */
const pairWithExtension = async (name: RegExp, uri: string) => {
  const extension = await findExtension(name);
  if (extension) window.postMessage({ type: CONNECT + extension.id, pairingString: uri }, window.location.origin);
};

type HederaWalletSpec = Pick<Wallet, "id" | "name" | "iconUrl" | "iconBackground" | "downloadUrls"> & {
  /** Matches the name the extension announces. */
  extensionName: RegExp;
  /** The app's deep-link scheme, from the WalletConnect registry. */
  nativeScheme: string;
};

const hederaWallet =
  ({ extensionName, nativeScheme, ...wallet }: HederaWalletSpec) =>
  ({
    projectId,
    walletConnectParameters,
  }: {
    projectId: string;
    walletConnectParameters?: RainbowKitWalletConnectParameters;
  }): Wallet => ({
    ...wallet,
    mobile: { getUri: uri => `${nativeScheme}wc?uri=${encodeURIComponent(uri)}` },
    qrCode: { getUri: uri => uri },
    createConnector: details => {
      const createWalletConnect = getWalletConnectConnector({ projectId, walletConnectParameters })(details);
      return config => {
        // wagmi emits the pairing URI only while this wallet is the one connecting.
        config.emitter.on("message", ({ type, data }) => {
          if (type === "display_uri" && typeof data === "string") void pairWithExtension(extensionName, data);
        });
        return createWalletConnect(config);
      };
    },
  });

export const hashpackWallet = hederaWallet({
  id: "hashpack",
  name: "HashPack (Hedera)",
  iconUrl: "/wallets/hashpack.jpg",
  iconBackground: "#1a1a2e",
  extensionName: /hashpack/i,
  nativeScheme: "hashpack://",
  downloadUrls: {
    chrome: "https://chromewebstore.google.com/detail/hashpack/gjagmgiddbbciopjhllkdnddhcglnemk",
    ios: "https://apps.apple.com/app/id6444389849",
    android: "https://play.google.com/store/apps/details?id=app.hashpack.wallet.twa",
    qrCode: "https://www.hashpack.app/download",
  },
});

export const kabilaWallet = hederaWallet({
  id: "kabila",
  name: "Kabila (Hedera)",
  iconUrl: "/wallets/kabila.png",
  iconBackground: "#ffffff",
  extensionName: /kabila/i,
  nativeScheme: "kabila-wallet://",
  downloadUrls: {
    chrome: "https://chromewebstore.google.com/detail/kabila-wallet/cnoepnljjcacmnjnopbhjelpmfokpijm",
    ios: "https://apps.apple.com/app/kabila-wallet/id6467106529",
    android: "https://play.google.com/store/apps/details?id=wallet.kabila.app",
    qrCode: "https://wallet.kabila.app",
  },
});
