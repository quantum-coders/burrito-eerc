// src/lib/wagmi.ts
import { createConfig, http } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet } from '@wagmi/connectors'

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID

// Detect client safely
const isClient = typeof window !== 'undefined'

// Build connectors ONLY on the client to avoid SSR/CJS touching ESM deps
const buildConnectors = () => {
  if (!isClient) return [] as const
  const base = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: 'Burrito — Private Wallet',
      appLogoUrl: `${window.location.origin}/favicon.ico`,
    }),
  ]
  return wcProjectId
    ? [
        ...base,
        walletConnect({
          projectId: wcProjectId,
          showQrModal: true,
          metadata: {
            name: 'Burrito — Private Wallet',
            description: 'Encrypted ERC-20 on Avalanche',
            url: window.location.origin,
            icons: [`${window.location.origin}/favicon.ico`],
          },
        }),
      ]
    : base
}

export const wagmiConfig = createConfig({
  chains: [avalanche],
  transports: { [avalanche.id]: http() },
  multiInjectedProviderDiscovery: true,
  ssr: true,
  // ⬇️ empty on server, real connectors on client
  connectors: buildConnectors(),
})
