// src/lib/wagmi.ts
import { createConfig, http } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID

const connectors = [
	injected({ shimDisconnect: true }),
	coinbaseWallet({
		appName: 'Burrito — Private Wallet',
		appLogoUrl:
			typeof window !== 'undefined'
				? `${ window.location.origin }/favicon.ico`
				: undefined,
	}),
	...(wcProjectId
		? [
			walletConnect({
				projectId: wcProjectId,
				showQrModal: true,
				metadata: {
					name: 'Burrito — Private Wallet',
					description: 'Encrypted ERC-20 on Avalanche',
					url:
						typeof window !== 'undefined'
							? window.location.origin
							: 'https://example.org',
					icons: [
						typeof window !== 'undefined'
							? `${ window.location.origin }/favicon.ico`
							: 'https://walletconnect.com/_next/static/media/walletconnect-logo.1c6b3f2a.svg',
					],
				},
			}),
		]
		: []),
] as const

export const wagmiConfig = createConfig({
	chains: [ avalanche ],
	transports: {
		[avalanche.id]: http(), // add your RPC if needed
	},
	multiInjectedProviderDiscovery: true,
	ssr: true,
	connectors,
})
