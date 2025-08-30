// src/pages/_app.tsx
import type { AppProps } from "next/app";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastContainer } from "react-toastify";
import { wagmiConfig } from "@/lib/wagmi";
import "react-toastify/dist/ReactToastify.css";
import "@/styles/globals.css"; // <- te doy este archivo en el punto 5

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (i) => Math.min(1000 * 2 ** i, 30000),
      refetchOnWindowFocus: false,
    },
  },
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
        <ToastContainer
          position="top-right"
          autoClose={5000}
          newestOnTop
          closeOnClick
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="dark"
          style={{
            fontSize: "13px",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
