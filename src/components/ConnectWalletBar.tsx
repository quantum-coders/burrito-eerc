import { useEffect, useMemo } from "react";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  useChains,
} from "wagmi";
import { avalanche } from "wagmi/chains";

export function ConnectWalletBar() {
  const { address, isConnected, connector } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { connectors, isLoading: loadingConnectors } = useConnectors();
  const { connectAsync, status, error } = useConnect();
  const { chains } = useChains();
  const { switchChainAsync } = useSwitchChain();

  // Helpful logs
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[connect] status:", status, "error:", error);
  }, [status, error]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[connect] discovered connectors:", connectors.map(c => ({
        id: c.id, name: c.name, type: c.type, uid: c.uid,
        ready: c.ready, // whether provider is present
      })));
    }
  }, [connectors]);

  const targetChainId = avalanche.id;
  const readyConnectors = useMemo(
    () =>
      connectors
        // Prefer unique connector ids
        .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
        // Put injected wallets first (Core, Phantom, etc.), then MetaMask/Coinbase, then WC
        .sort((a, b) => Number(b.ready) - Number(a.ready)),
    [connectors]
  );

  const handleConnect = async (cId: string) => {
    try {
      const selected = connectors.find(c => c.id === cId);
      if (!selected) throw new Error("Connector not found");

      // eslint-disable-next-line no-console
      console.log("[connect] trying connector:", selected.name, selected);

      const data = await connectAsync({ connector: selected });
      // eslint-disable-next-line no-console
      console.log("[connect] connected:", data);

      // ensure we’re on Avalanche
      try {
        await switchChainAsync({ chainId: targetChainId });
        // eslint-disable-next-line no-console
        console.log("[connect] switched to Avalanche C-Chain:", targetChainId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[connect] switchChain failed (user can switch manually):", e);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[connect] error:", e);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectAsync();
      // eslint-disable-next-line no-console
      console.log("[connect] disconnected");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[connect] disconnect error:", e);
    }
  };

  return (
    <div className="cw-wrapper" role="region" aria-label="Wallet connection">
      <div className="cw-row">
        {!isConnected ? (
          <>
            {loadingConnectors ? (
              <span className="cw-text">Loading wallets…</span>
            ) : readyConnectors.length === 0 ? (
              <span className="cw-text">
                No injected wallets found. Try WalletConnect (QR) or install Core / Phantom / MetaMask.
              </span>
            ) : (
              readyConnectors.map((c) => (
                <button
                  key={c.uid}
                  className="cw-btn"
                  onClick={() => handleConnect(c.id)}
                  disabled={!c.ready}
                  title={`Connect with ${c.name}`}
                >
                  {c.ready ? `Connect ${c.name}` : `${c.name} (not installed)`}
                </button>
              ))
            )}
          </>
        ) : (
          <div className="cw-connected">
            <span className="cw-text">
              Connected: {address?.slice(0, 6)}…{address?.slice(-4)} via <strong>{connector?.name}</strong>
            </span>
            <button className="cw-btn danger" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .cw-wrapper { display:flex; justify-content:center; margin:10px 0 16px; }
        .cw-row { display:flex; flex-wrap:wrap; gap:8px; }
        .cw-btn {
          appearance:none; cursor:pointer;
          border:1px solid rgba(255,255,255,0.12);
          background: linear-gradient(180deg, #D75D41, #B9442B);
          color:#fff; padding:8px 12px; border-radius:10px;
          font-size:13px; font-weight:600;
        }
        .cw-btn:hover { filter:brightness(1.05); }
        .cw-btn:disabled { opacity:0.6; cursor:not-allowed; }
        .cw-btn.danger { background:#222; border-color:#444; }
        .cw-text { font-size:13px; color:#ddd; align-self:center; }
        .cw-connected { display:flex; gap:8px; align-items:center; }
      `}</style>
    </div>
  );
}
