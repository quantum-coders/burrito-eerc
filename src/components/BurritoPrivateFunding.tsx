/* eslint-disable no-console */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount, useChainId, useConnect, useDisconnect, usePublicClient,
  useSwitchChain, useWalletClient, useSignMessage,
} from "wagmi";
import { avalanche } from "wagmi/chains";
import {
  formatUnits, parseUnits, parseAbiItem, maxUint256,
  type Address,
} from "viem";
import {
  useEERC,
  type CompatiblePublicClient,
  type CompatibleWalletClient,
} from "@avalabs/eerc-sdk";
import { toast } from "react-toastify";

/* ================== HARD-CODED CONFIG (no envs) ================== */
const BURRITO_TOKEN: Address = "0xf65645a42609f6b44E2EC158A3Dc2b6CfC97093f";
const EERC_CONTRACT: Address = "0x2f1836b1a43B49CeF81B52a0C5b850d67030c020";

// IMPORTANTE: usar URLs ABSOLUTAS para evitar file:// en el SDK
function getCircuitConfig() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = origin ? `${origin}/eerc` : "/eerc"; // fallback por si algo corre antes de montar

  const registration = { wasm: `${base}/registration.wasm`, zkey: `${base}/registration.zkey` };
  const transfer     = { wasm: `${base}/transfer.wasm`,     zkey: `${base}/transfer.zkey`     };
  const withdraw     = { wasm: `${base}/withdraw.wasm`,     zkey: `${base}/withdraw.zkey`     };
  const mint         = { wasm: `${base}/mint.wasm`,         zkey: `${base}/mint.zkey`         };
  const burn         = { wasm: `${base}/burn.wasm`,         zkey: `${base}/burn.zkey`         };

  // el SDK acepta "register" y tu health-check usa "registration" → exponemos ambos
  return {
    register: registration,
    registration,
    transfer,
    withdraw,
    mint,
    burn,
  };
}

/* ================== ABIs mínimos ================== */
const ERC20_DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const ERC20_APPROVE_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve",   stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const EVT_DEPOSIT = parseAbiItem(
  "event Deposit(address indexed user, uint256 amount, uint256 dust, uint256 tokenId)"
);

const short = (addr?: Address | null) => addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : "";

/* ============= Component ============= */
export default function BurritoPrivateFunding() {
  const circuits = getCircuitConfig();

  // Wallet + chain
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: avalanche.id });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { connectAsync, connectors, status: connectStatus, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  // UI state
  const [showConnect, setShowConnect] = useState(false);
  const [amountDeposit, setAmountDeposit] = useState("");     // public → private
  const [amountWithdraw, setAmountWithdraw] = useState("");   // private → public
  const [toPriv, setToPriv] = useState<Address | "">("");     // private transfer recipient
  const [amountPriv, setAmountPriv] = useState("");           // private transfer amount
  const [rid] = useState<string>(() =>
    typeof window !== "undefined" ? crypto.randomUUID() : "temp-rid"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | "">("");

  // Decimals (on-chain, ERC-20)
  const [erc20Decimals, setErc20Decimals] = useState<number>(18);

  // Health check: circuits existence
  const [circuitsHealth, setCircuitsHealth] = useState<Record<string, string>>({});

  // EERC hook
  const {
    isRegistered,
    isDecryptionKeySet,
    generateDecryptionKey,
    register,
    isAddressRegistered,
    useEncryptedBalance,
    auditorAddress,
    auditorPublicKey: auditorPkFromHook,
  } = useEERC(
    publicClient as CompatiblePublicClient,
    walletClient as CompatibleWalletClient,
    EERC_CONTRACT,
    circuits as any
  );

  // Encrypted balance hook (converter mode → pass BURRITO_TOKEN)
  const eb = useEncryptedBalance(BURRITO_TOKEN);
  const {
    decryptedBalance,      // bigint (atomic, *private decimals*)
    decimals,              // bigint → *private decimals*, típicamente 2
    deposit,               // (amountAtomic: bigint) → Deposit (ERC20→privado)
    withdraw,              // (amountAtomic: bigint) → Withdraw (privado→ERC20)
    privateTransfer,       // (to, amountAtomic) → Transfer privado
    refetchBalance,        // update local snapshot
  } = eb;

  // Mantener el último decryptedBalance fresco
  const lastPrivAtomicRef = useRef<bigint>(0n);
  useEffect(() => { lastPrivAtomicRef.current = decryptedBalance ?? 0n; }, [decryptedBalance]);

  // Decimals resoluciones
  const eercDecimals = useMemo(() => {
    const n = Number(decimals ?? 2n);
    if (!Number.isFinite(n) || n <= 0 || n > 36) return 2;
    return n;
  }, [decimals]);

  // Mostrar private balance en tokens (no wei)
  const privTokens = useMemo(() => {
    const v = decryptedBalance ?? 0n;
    return formatUnits(v, eercDecimals);
  }, [decryptedBalance, eercDecimals]);

  // === On mount: HEAD/GET de circuitos para detectar 404/format ===
  useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const key of ["registration", "transfer", "withdraw", "mint", "burn"] as const) {
        const cfg = (circuits as any)[key];
        if (!cfg) continue;
        if (cfg.wasm) {
          const r = await fetch(cfg.wasm, { method: "HEAD", cache: "no-store" });
          out[`${key}.wasm`] = `${r.ok ? "OK" : "FAIL"} ${r.status}`;
        }
        if (cfg.zkey) {
          const h = await fetch(cfg.zkey, { method: "HEAD", cache: "no-store" });
          out[`${key}.zkey/HEAD`] = `${h.ok ? "OK" : "FAIL"} ${h.status}`;
          const g = await fetch(cfg.zkey, { cache: "no-store" });
          out[`${key}.zkey/GET`] = `${g.ok ? "OK" : "FAIL"} ${g.status} bytes=${g.ok ? (await g.arrayBuffer()).byteLength : 0}`;
        }
      }
      console.table(out);
      setCircuitsHealth(out);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === ERC-20 decimals ===
  useEffect(() => {
    (async () => {
      if (!publicClient) return;
      try {
        const d = await publicClient.readContract({
          address: BURRITO_TOKEN,
          abi: ERC20_DECIMALS_ABI,
          functionName: "decimals",
        });
        const n = Number(d);
        console.log("[BPF] ERC-20 decimals on-chain:", n);
        setErc20Decimals(Number.isFinite(n) ? n : 18);
      } catch {
        console.warn("[BPF] decimals() read failed — defaulting 18");
        setErc20Decimals(18);
      }
    })();
  }, [publicClient]);

  // === Auto refresh al conectar / cuando ya hay key+registro ===
  useEffect(() => {
    (async () => {
      if (!isConnected || !isDecryptionKeySet || !isRegistered) return;
      console.log("[BPF] auto-refetch on connect/reg/key");
      await refetchBalance();
      await new Promise(r => setTimeout(r, 250));
      console.log("[BPF] auto-refetch done");
    })();
  }, [isConnected, isDecryptionKeySet, isRegistered, refetchBalance]);

  // === Connect / Disconnect ===
  const connectWith = useCallback(async (connectorId: string) => {
    const c = connectors.find((x) => x.id === connectorId);
    if (!c) return toast.error("Connector not available");
    try {
      const res = await connectAsync({ connector: c });
      localStorage.setItem("wagmi.lastUsedConnector", connectorId);
      toast.success(`Connected: ${short(res.accounts?.[0] as Address)}`);
      if (res.chainId !== avalanche.id) {
        await switchChainAsync({ chainId: avalanche.id }).catch(() => {
          toast.warning("Please switch to Avalanche C-Chain");
        });
      }
    } catch (e) {
      toast.error((e as Error).message || "Failed to connect wallet");
      setShowConnect(true);
    }
  }, [connectAsync, connectors, switchChainAsync]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    localStorage.removeItem("wagmi.lastUsedConnector");
    toast.info("Wallet disconnected");
  }, [disconnect]);

  const ensureNetwork = useCallback(async () => {
    if (!walletClient) return false;
    try {
      const current = await walletClient.getChainId();
      if (current !== avalanche.id) {
        await switchChainAsync({ chainId: avalanche.id });
      }
      return true;
    } catch (e) {
      console.error("[BPF] ensureNetwork:", (e as Error).message);
      return false;
    }
  }, [walletClient, switchChainAsync]);

  /* ================== ALLOWANCE HELPER ================== */
  const ensureAllowance = useCallback(
    async (owner: Address, spender: Address, amount: bigint) => {
      if (!publicClient || !walletClient) throw new Error("No client");
      // 1) leer allowance
      const current: bigint = await publicClient.readContract({
        address: BURRITO_TOKEN,
        abi: ERC20_APPROVE_ABI,
        functionName: "allowance",
        args: [owner, spender],
      });
      console.log("[BPF][approve] current allowance:", current.toString(), "| need:", amount.toString());
      if (current >= amount) return { approved: true, hash: "" as `0x${string}` };

      // helper para enviar approve y esperar
      const sendApprove = async (value: bigint) => {
        const hash = await walletClient.writeContract({
          address: BURRITO_TOKEN,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [spender, value],
          account: owner,
        });
        console.log("[BPF][approve] tx:", hash);
        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
      };

      try {
        // 2) intentar approve directo por el monto exacto
        toast.info("Sending ERC‑20 approve…");
        const h = await sendApprove(amount);
        toast.success(<><b>Approve sent</b><br/><small>{h}</small></>);
        return { approved: true, hash: h };
      } catch (e1) {
        console.warn("[BPF][approve] direct approve failed, trying reset-to-zero then approve:", (e1 as Error).message);
        // 3) fallback: reset a 0 y luego approve exacto (para tokens tipo USDT)
        try {
          const h0 = await sendApprove(0n);
          console.log("[BPF][approve] reset-to-zero tx:", h0);
        } catch (e0) {
          console.error("[BPF][approve] zero-reset failed:", (e0 as Error).message);
          throw e1; // si ni reset deja, propagate el error original
        }
        const h = await sendApprove(amount);
        toast.success(<><b>Approve sent</b><br/><small>{h}</small></>);
        return { approved: true, hash: h };
      }
    },
    [publicClient, walletClient]
  );

  /* ================== ACTIONS ================== */

  // 1) Generate local decryption key
  const handleGenerateKey = useCallback(async () => {
    if (!isConnected) return toast.error("Connect your wallet first");
    try {
      const ok = await ensureNetwork(); if (!ok) return toast.warning("Please switch to Avalanche C-Chain");
      const key = await generateDecryptionKey();
      console.log("[BPF] key generated:", key ? "ok" : "??");
      toast.success("Decryption key generated");
      await refetchBalance();
    } catch (e) {
      console.error("[BPF] generateDecryptionKey error:", (e as Error).message);
      toast.error((e as Error).message || "Failed to generate key");
    }
  }, [isConnected, ensureNetwork, generateDecryptionKey, refetchBalance]);

  // 2) Register
  const handleRegister = useCallback(async () => {
    if (!isConnected) return toast.error("Connect your wallet first");
    try {
      const ok = await ensureNetwork(); if (!ok) return toast.warning("Please switch to Avalanche C-Chain");
      const { transactionHash } = await register();
      console.log("[BPF] register tx:", transactionHash);
      toast.success(<><b>Registration sent</b><br/><small>{transactionHash}</small></>);
      await refetchBalance();
    } catch (e) {
      console.error("[BPF] register error:", (e as Error).message);
      toast.error((e as Error).message || "Registration failed");
    }
  }, [isConnected, ensureNetwork, register, refetchBalance]);

  // 3) Deposit (public → private)
  const handleDeposit = useCallback(async () => {
    if (!isConnected || !address) return toast.error("Connect your wallet first");
    if (!amountDeposit || Number(amountDeposit) <= 0) return toast.error("Enter a valid amount");
    if (!isDecryptionKeySet) return toast.error("Generate your decryption key first");
    if (!isRegistered) return toast.error("Register first");

    // pre-check auditor PK (evita revert por Auditor no seteado)
    const hasAuditor =
      Array.isArray(auditorPkFromHook) &&
      auditorPkFromHook.length >= 2 &&
      (auditorPkFromHook[0] !== 0n || auditorPkFromHook[1] !== 0n);
    if (!hasAuditor) {
      return toast.error("Auditor public key is not set on contract");
    }

    try {
      const ok = await ensureNetwork(); if (!ok) return toast.warning("Please switch to Avalanche C-Chain");
      setIsLoading(true);

      const atomic18 = parseUnits(amountDeposit, erc20Decimals);
      console.log("[BPF][deposit] erc20Decimals:", erc20Decimals, "| amount:", amountDeposit, "→ atomic18:", atomic18.toString());

      // === ensure allowance ===
      await ensureAllowance(address as Address, EERC_CONTRACT, atomic18);

      // === deposit ===
      const { transactionHash } = await deposit(atomic18);
      console.log("[BPF][deposit] tx:", transactionHash);
      setTxHash(transactionHash as any);
      toast.success(<>Deposit submitted<br/><small>{transactionHash}</small></>);

      // refresh local snapshot
      await refetchBalance();
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error("[BPF][deposit] error:", (e as Error).message);
      toast.error((e as Error).message || "Deposit failed");
    } finally {
      setIsLoading(false);
    }
  }, [
    isConnected, address, amountDeposit, isDecryptionKeySet, isRegistered,
    ensureNetwork, erc20Decimals, ensureAllowance, deposit, refetchBalance, auditorPkFromHook
  ]);

  // 4) Private transfer (sender → recipient)
  const handlePrivateTransfer = useCallback(async () => {
    if (!isConnected || !address) return toast.error("Connect your wallet first");
    if (!toPriv) return toast.error("Enter a recipient address");
    if (!amountPriv || Number(amountPriv) <= 0) return toast.error("Enter a valid amount");
    try {
      const ok = await ensureNetwork(); if (!ok) return toast.warning("Please switch to Avalanche C-Chain");

      // El destinatario DEBE estar registrado
      const reg = await isAddressRegistered(toPriv as Address);
      if (!reg?.isRegistered) return toast.error("Recipient is not registered in eERC");

      // Asegura balances frescos
      await refetchBalance(); await new Promise(r => setTimeout(r, 200));
      const before = lastPrivAtomicRef.current;
      const atomic = parseUnits(amountPriv, eercDecimals);

      const { transactionHash } = await privateTransfer(toPriv as Address, atomic);
      console.log("[BPF][privateTransfer] tx:", transactionHash);
      toast.success(<>Private transfer sent<br/><small>{transactionHash}</small></>);

      // Refresh
      await refetchBalance(); await new Promise(r => setTimeout(r, 300));
      const after = lastPrivAtomicRef.current;
      console.log("[BPF][privateTransfer] Δ:", (after - before).toString());
    } catch (e) {
      console.error("[BPF][privateTransfer] error:", (e as Error).message);
      toast.error((e as Error).message || "Private transfer failed");
    }
  }, [isConnected, address, toPriv, amountPriv, ensureNetwork, isAddressRegistered, refetchBalance, eercDecimals, privateTransfer]);

  // 5) Withdraw (private → public ERC‑20)
  const handleWithdraw = useCallback(async () => {
    if (!isConnected || !address) return toast.error("Connect your wallet first");
    if (!amountWithdraw || Number(amountWithdraw) <= 0) return toast.error("Enter a valid amount");
    try {
      const ok = await ensureNetwork(); if (!ok) return toast.warning("Please switch to Avalanche C-Chain");

      // siempre montar balances frescos justo antes de probar
      await refetchBalance(); await new Promise(r => setTimeout(r, 200));
      const before = lastPrivAtomicRef.current;

      const atomic = parseUnits(amountWithdraw, eercDecimals);
      const t0 = performance.now();
      const { transactionHash } = await withdraw(atomic);
      const dt = Math.round(performance.now() - t0);
      console.log("[BPF][withdraw] tx:", transactionHash, "| proof+send ms:", dt);

      toast.success(<>Withdraw sent<br/><small>{transactionHash}</small></>);

      // refresh
      await refetchBalance(); await new Promise(r => setTimeout(r, 300));
      const after = lastPrivAtomicRef.current;
      console.log("[BPF][withdraw] Δ:", (after - before).toString());
    } catch (e: any) {
      console.error("[BPF][withdraw] error:", e);
      toast.error(e?.shortMessage || e?.message || "Withdraw failed");
    }
  }, [isConnected, address, amountWithdraw, ensureNetwork, refetchBalance, eercDecimals, withdraw]);

  // Refresh “total” con diagnóstico extra
  const debugRefresh = useCallback(async (why: string = "button") => {
    console.group(`[BPF][refresh] ${why}`);
    try {
      console.log("• addr:", address, "| connected:", isConnected, "chainId:", chainId);
      console.log("• isKey:", isDecryptionKeySet, "isReg:", isRegistered);
      console.log("• erc20Decimals:", erc20Decimals, " | eercDecimals:", eercDecimals);

      const before = decryptedBalance ?? 0n;
      console.log("• private before (atomic):", before.toString(), "→ tokens:", formatUnits(before, eercDecimals));

      const t0 = performance.now();
      await refetchBalance();
      await new Promise(r => setTimeout(r, 300));
      const after = lastPrivAtomicRef.current ?? 0n;
      console.log("• private after  (atomic):", after.toString(), "→ tokens:", formatUnits(after, eercDecimals));
      console.log("• Δ atomic:", (after - before).toString(), "Δms:", Math.round(performance.now() - t0));

      // On-chain scan: últimos Deposit del usuario
      if (publicClient && address) {
        try {
          const logs = await publicClient.getLogs({
            address: EERC_CONTRACT,
            event: EVT_DEPOSIT,
            args: { user: address as Address },
            fromBlock: 0n,
            toBlock: "latest",
          });
          console.log("[BPF][refresh] Deposit logs:", logs.length);
          if (logs.length) {
            const last = logs[logs.length - 1];
            console.log("[BPF][refresh] last Deposit → tokenId:", last.args?.tokenId?.toString(), "amount:", last.args?.amount?.toString(), "tx:", last.transactionHash);
          }
        } catch (e) {
          console.warn("[BPF][refresh] log scan failed:", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("[BPF][refresh] error:", (e as Error).message);
    } finally {
      console.groupEnd();
    }
  }, [address, isConnected, chainId, isDecryptionKeySet, isRegistered, erc20Decimals, eercDecimals, decryptedBalance, refetchBalance, publicClient]);

  /* ================== UI ================== */
  const wrongNetwork = isConnected && chainId !== avalanche.id;
  const isProcessing = isConnecting || isSwitchingChain || connectStatus === "pending";

  return (
    <div className="bpf-wrapper">
      <div className="bpf-card">
        <header className="bpf-header">
          <div className="bpf-brand-dot" />
          <div className="bpf-title">
            <h2>Burrito — Private Wallet</h2>
            <p>Converter & Private Transfers · Avalanche C‑Chain</p>
          </div>
          <div className="bpf-spacer" />
          {!isConnected ? (
            <button className="bpf-btn primary" onClick={() => setShowConnect(true)} disabled={isProcessing}>
              {isProcessing ? "Connecting..." : "Connect Wallet"}
            </button>
          ) : (
            <div className="bpf-wallet">
              <span className="bpf-pill">{short(address as Address)}</span>
              <button className="bpf-icon" title="Disconnect" onClick={handleDisconnect}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 13v-2H7V8l-5 4 5 4v-3h9zm3-12H9c-1.1 0-2 .9-2 2v4h2V3h10v18H9v-4H7v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2z" />
                </svg>
              </button>
            </div>
          )}
        </header>

        {wrongNetwork && (
          <div className="bpf-alert">
            You are on the wrong network.&nbsp;
            <button className="bpf-btn tiny" onClick={() => ensureNetwork()} disabled={isSwitchingChain}>
              {isSwitchingChain ? "Switching..." : "Switch to Avalanche C-Chain"}
            </button>
          </div>
        )}

        <div className="bpf-grid">
          <div className="bpf-field">
            <label>RID (tracking)</label>
            <input value={rid} readOnly />
          </div>
          <div className="bpf-field">
            <label>ERC-20 (public) → e.BURRITO (private)</label>
            <div className="bpf-row">
              <input
                inputMode="decimal"
                value={amountDeposit}
                onChange={(e) => setAmountDeposit(e.target.value)}
                placeholder="Amount to deposit"
              />
              <button className="bpf-btn" onClick={handleDeposit} disabled={!amountDeposit || isLoading}>
                {isLoading ? "Processing…" : "Deposit"}
              </button>
            </div>
            <small className="bpf-muted">ERC‑20 decimals: {erc20Decimals} • private decimals: {eercDecimals}</small>
          </div>
        </div>

        <div className="bpf-grid" style={{ marginTop: 10 }}>
          <div className="bpf-field">
            <label>Private transfer (recipient must be registered)</label>
            <input
              value={toPriv}
              onChange={(e) => setToPriv(e.target.value as Address)}
              placeholder="Recipient (0x…)"/>
            <div className="bpf-row" style={{ marginTop: 6 }}>
              <input
                inputMode="decimal"
                value={amountPriv}
                onChange={(e) => setAmountPriv(e.target.value)}
                placeholder="Amount (e.BURRITO)"
              />
              <button className="bpf-btn" onClick={handlePrivateTransfer} disabled={!amountPriv || !toPriv}>
                Send privately
              </button>
            </div>
          </div>

          <div className="bpf-field">
            <label>e.BURRITO (private) → ERC-20 (public)</label>
            <div className="bpf-row">
              <input
                inputMode="decimal"
                value={amountWithdraw}
                onChange={(e) => setAmountWithdraw(e.target.value)}
                placeholder="Amount to withdraw"
              />
              <button className="bpf-btn" onClick={handleWithdraw} disabled={!amountWithdraw}>
                Withdraw
              </button>
            </div>
          </div>
        </div>

        <hr className="bpf-sep" />

        <section className="bpf-balance">
          <h3>🔐 Private balance (local)</h3>
          <p className="bpf-balance-num"><strong>{privTokens}</strong> e.BURRITO</p>
          <div className="bpf-actions">
            <button className="bpf-btn ghost" onClick={() => debugRefresh("button")} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button className="bpf-btn" onClick={handleGenerateKey} disabled={!isConnected || isDecryptionKeySet}>
              {isDecryptionKeySet ? "✓ Decryption key ready" : "Generate key"}
            </button>
            <button className="bpf-btn" onClick={handleRegister} disabled={!isConnected || !isDecryptionKeySet || isRegistered}>
              {isRegistered ? "✓ Registered" : "Register"}
            </button>
          </div>
        </section>

        <hr className="bpf-sep" />

        {/* Debug Tools */}
        <section>
          <h4>🧪 Debug tools</h4>
          <div className="bpf-summary">
            <div><span className="k">auditor (registrar):</span><code className="bpf-code">{auditorAddress || "(unknown)"}</code></div>
            <div><span className="k">ERC‑20 decimals:</span><code className="bpf-code">{erc20Decimals}</code></div>
            <div><span className="k">eERC decimals (hook):</span><code className="bpf-code">{eercDecimals}</code></div>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "#b5b5b5" }}>Circuits health (HEAD/GET)</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(circuitsHealth, null, 2)}</pre>
          </details>
        </section>
      </div>

      {/* Connect sheet */}
      {showConnect && (
        <div className="bpf-sheet" role="dialog" aria-modal="true" aria-label="Select a wallet">
          <div className="bpf-sheet-card">
            <div className="bpf-sheet-header">
              <h4>Connect Wallet</h4>
              <button className="bpf-icon" onClick={() => setShowConnect(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.3-6.3 6.3-6.29z" />
                </svg>
              </button>
            </div>
            <div className="bpf-connectors">
              {connectors.map((c) => (
                <button key={c.uid} className="bpf-conn" onClick={() => connectWith(c.id)} title={c.name}>
                  <span className="bpf-conn-icon">🔌</span>
                  <span>{c.name}</span>
                </button>
              ))}
              {connectError ? <p className="bpf-error">{connectError.message}</p> : null}
            </div>
          </div>
        </div>
      )}

      {/* Styles */}
      <style jsx>{`
        .bpf-wrapper {
          --brand1: #d75d41;
          --brand2: #f09f33;
          --bg: #101010;
          --panel: #1a1a1a;
          --text: #f5f5f5;
          --muted: #b5b5b5;
          --border: rgba(255, 255, 255, 0.12);
          --ring: rgba(215, 93, 65, 0.35);
          display: grid;
          place-items: center;
          width: 100%;
          min-width: 320px;
          color: var(--text);
          background: linear-gradient(180deg, rgba(215,93,65,.06), rgba(240,159,51,.06)), var(--bg);
          font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
        }
        .bpf-card {
          width: 100%;
          max-width: 680px;
          background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(0,0,0,.15)), var(--panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 18px;
          box-shadow: 0 8px 40px rgba(0, 0, 0, .35);
        }
        .bpf-header {
          display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
        }
        .bpf-brand-dot {
          width: 14px; height: 14px; border-radius: 50%;
          background: radial-gradient(50% 50%, var(--brand2), var(--brand1));
          box-shadow: 0 0 0 4px rgba(240, 159, 51, 0.18), 0 0 0 8px rgba(215, 93, 65, 0.1);
        }
        .bpf-title h2 { margin: 0; font-size: 18px; letter-spacing: 0.3px; }
        .bpf-title p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
        .bpf-spacer { flex: 1; }
        .bpf-wallet { display: flex; align-items: center; gap: 8px; }
        .bpf-pill {
          background: #141414; border: 1px solid var(--border);
          border-radius: 999px; padding: 6px 10px; font-weight: 700; font-size: 12px;
        }
        .bpf-icon {
          appearance: none; background: #141414; border: 1px solid var(--border);
          color: var(--text); padding: 8px; border-radius: 10px; cursor: pointer; line-height: 0;
        }
        .bpf-icon:hover { border-color: var(--ring); }
        .bpf-alert {
          display: flex; align-items: center; gap: 10px;
          background: rgba(215,93,65,.12); border: 1px solid rgba(215,93,65,.35);
          color: #fbf7ee; padding: 10px 12px; border-radius: 10px; font-size: 13px; margin-bottom: 10px;
        }
        .bpf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
        @media (max-width: 680px) { .bpf-grid { grid-template-columns: 1fr; } }
        .bpf-field { display: flex; flex-direction: column; gap: 6px; }
        label { color: var(--muted); font-size: 12px; }
        input {
          appearance: none; background: #141414; color: var(--text);
          border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; outline: none;
          transition: border-color .2s, box-shadow .2s; width: 100%;
        }
        input[readonly] { color: #d0d0d0; background: #131313; }
        input:focus { border-color: var(--ring); box-shadow: 0 0 0 3px var(--ring); }
        .bpf-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .bpf-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
        .bpf-btn {
          appearance: none; border: 1px solid var(--border); background: #171717;
          color: var(--text); padding: 10px 14px; border-radius: 10px; cursor: pointer;
          transition: transform .06s ease, border-color .15s, background .15s;
          font-weight: 600; font-size: 13px;
        }
        .bpf-btn:hover:not(:disabled) { border-color: var(--ring); transform: translateY(-1px); }
        .bpf-btn:disabled { opacity: .6; cursor: not-allowed; }
        .bpf-btn.primary { background: linear-gradient(180deg, var(--brand1), #b9442b); border-color: rgba(215,93,65,.55); }
        .bpf-btn.ghost { background: #141414; }
        .bpf-muted { color: var(--muted); font-size: 12px; margin: 8px 0 0; display: inline-block; }
        .bpf-sep { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
        .bpf-balance h3, section h4 { margin: 0 0 8px; font-size: 14px; color: #fbf7ee; }
        .bpf-balance-num { margin: 0 0 8px; font-size: 16px; }
        .bpf-summary { display: grid; gap: 6px; font-size: 13px; }
        .bpf-summary .k { color: var(--muted); margin-right: 8px; }
        .bpf-sheet { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; z-index: 50; }
        .bpf-sheet-card {
          width: 100%; max-width: 420px; background: #121212; border: 1px solid var(--border);
          border-radius: 14px; padding: 14px; box-shadow: 0 8px 40px rgba(0, 0, 0, .45);
        }
        .bpf-sheet-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .bpf-connectors { display: grid; gap: 8px; }
        .bpf-conn {
          display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: #171717;
          color: var(--text); padding: 10px 12px; border-radius: 10px; cursor: pointer; text-align: left;
        }
        .bpf-conn:hover:not(:disabled) { border-color: var(--ring); }
        .bpf-conn-icon {
          width: 24px; height: 24px; display: grid; place-items: center; background: #141414;
          border-radius: 8px; border: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
