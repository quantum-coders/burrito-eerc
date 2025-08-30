// src/lib/wagmi.ts
/* eslint-disable no-console */
import { createConfig, http } from "wagmi";
import { avalanche } from "wagmi/chains";
import {
  injected,
  metaMask,
  coinbaseWallet,
  walletConnect,
} from "wagmi/connectors";

const RPC_URL = process.env.NEXT_PUBLIC_AVAX_RPC || "https://api.avax.network/ext/bc/C/rpc";
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

// Exigimos WalletConnect por robustez (iframes / mobile)
if (!WC_PROJECT_ID) {
  console.error(
    "[wagmi] NEXT_PUBLIC_WC_PROJECT_ID is missing. WalletConnect QR will NOT work (required for iframe/mobile)."
  );
}

export const wagmiConfig = createConfig({
  chains: [avalanche],
  transports: {
    [avalanche.id]: http(RPC_URL, {
      batch: true,
      retryCount: 3,
      retryDelay: 900,
    }),
  },
  connectors: [
    // Descubre Core/Phantom/Rabby/Brave/etc. vía injected
    injected({ shimDisconnect: true }),

    // MetaMask (maneja variantes especiales)
    metaMask({ dappMetadata: { name: "Burrito Private Funding" } }),

    // Coinbase Wallet
    coinbaseWallet({
      appName: "Burrito Private Funding",
      jsonRpcUrl: RPC_URL,
    }),

    // WalletConnect siempre presente (requerido para iframe)
    walletConnect({
      projectId: WC_PROJECT_ID || "demo", // "demo" solo para DEV local
      showQrModal: true,
      metadata: {
        name: "Burrito Private Funding",
        description: "Private funding on Avalanche (eERC Converter)",
        url:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://example.org",
        icons: [
          "https://avatars.githubusercontent.com/u/74507509?s=200&v=4",
        ],
      },
    }),
  ],
  ssr: true,
});

if (typeof window !== "undefined") {
  console.log("[wagmi] config ready, connectors:",
    // @ts-expect-error debug
    (wagmiConfig.connectors ?? []).map(c => ({ id: c.id, name: c.name }))
  );
}
