// src/pages/_app.tsx
import type { AppProps } from 'next/app'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '../lib/wagmi'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import '../styles/globals.css'

// ⬇️ Load modal only on client to avoid any SSR 'window' surprises.
const WalletModalRoot = dynamic(() => import('../components/WalletModalRoot'), {
  ssr: false,
})

const queryClient = new QueryClient()

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Burrito — Private Wallet</title>
      </Head>

      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <Component {...pageProps} />
          <WalletModalRoot />
          <ToastContainer position="bottom-right" theme="dark" autoClose={3000} newestOnTop />
        </QueryClientProvider>
      </WagmiProvider>
    </>
  )
}
