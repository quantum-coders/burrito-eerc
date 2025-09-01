/* eslint-disable no-console */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	useAccount, useChainId, useConnect, useDisconnect, usePublicClient,
	useSwitchChain, useWalletClient,
} from "wagmi";
import { avalanche } from "wagmi/chains";
import {
	formatUnits, parseUnits,
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

// Use ABSOLUTE URLs for circuit assets
function getCircuitConfig() {
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const base = origin ? `${ origin }/eerc` : "/eerc";
	return {
		registration: { wasm: `${ base }/registration.wasm`, zkey: `${ base }/registration.zkey` },
		transfer: { wasm: `${ base }/transfer.wasm`, zkey: `${ base }/transfer.zkey` },
		withdraw: { wasm: `${ base }/withdraw.wasm`, zkey: `${ base }/withdraw.zkey` },
		mint: { wasm: `${ base }/mint.wasm`, zkey: `${ base }/mint.zkey` },
		burn: { wasm: `${ base }/burn.wasm`, zkey: `${ base }/burn.zkey` },
	} as const;
}

/* ================== ABIs (minimal) ================== */
const ERC20_DECIMALS_ABI = [
	{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [ { type: "uint8" } ] },
] as const;

const ERC20_APPROVE_ABI = [
	{
		type: "function", name: "allowance", stateMutability: "view",
		inputs: [ { type: "address" }, { type: "address" } ], outputs: [ { type: "uint256" } ]
	},
	{
		type: "function", name: "approve", stateMutability: "nonpayable",
		inputs: [ { type: "address" }, { type: "uint256" } ], outputs: [ { type: "bool" } ]
	},
] as const;

const short = (addr?: Address | null) => (addr ? `${ addr.slice(0, 6) }…${ addr.slice(-4) }` : "");

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

	// UI state
	const [ showConnect, setShowConnect ] = useState(false);
	const [ amountDeposit, setAmountDeposit ] = useState("");     // public → private
	const [ amountWithdraw, setAmountWithdraw ] = useState("");   // private → public
	const [ toPriv, setToPriv ] = useState<Address | "">("");     // private transfer recipient
	const [ amountPriv, setAmountPriv ] = useState("");           // private transfer amount
	const [ rid ] = useState<string>(() =>
		(typeof window !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : "rid"
	);
	const [ isLoading, setIsLoading ] = useState(false);
	const [ isRefreshing, setIsRefreshing ] = useState(false);
	const [ txHash, setTxHash ] = useState<`0x${ string }` | "">("");

	// Decimals (on-chain, ERC-20)
	const [ erc20Decimals, setErc20Decimals ] = useState<number>(18);

	// EERC hook
	const {
		isRegistered,
		isDecryptionKeySet,
		generateDecryptionKey,
		register,
		isAddressRegistered,
		useEncryptedBalance,
		auditorPublicKey: auditorPkFromHook, // kept for internal checks, not shown in UI
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
		decimals,              // bigint → *private decimals*, typically 2
		deposit,               // (amountAtomic: bigint) → Deposit (ERC20→private)
		withdraw,              // (amountAtomic: bigint) → Withdraw (private→ERC20)
		privateTransfer,       // (to, amountAtomic) → Private transfer
		refetchBalance,        // refresh local snapshot
	} = eb;

	// Keep latest decrypted balance
	const lastPrivAtomicRef = useRef<bigint>(0n);
	useEffect(() => {
		lastPrivAtomicRef.current = decryptedBalance ?? 0n;
	}, [ decryptedBalance ]);

	// eERC private decimals
	const eercDecimals = useMemo(() => {
		const n = Number(decimals ?? 2n);
		return Number.isFinite(n) && n > 0 && n <= 36 ? n : 2;
	}, [ decimals ]);

	// Visible balance string
	const privTokens = useMemo(() => {
		const v = decryptedBalance ?? 0n;
		return formatUnits(v, eercDecimals);
	}, [ decryptedBalance, eercDecimals ]);

	// === ERC-20 decimals ===
	useEffect(() => {
		(async () => {
			if (!publicClient) return;
			try {
				const d = await publicClient.readContract({
					address: BURRITO_TOKEN, abi: ERC20_DECIMALS_ABI, functionName: "decimals",
				});
				const n = Number(d);
				setErc20Decimals(Number.isFinite(n) ? n : 18);
			} catch {
				console.warn("[BPF] decimals() read failed — defaulting 18");
				setErc20Decimals(18);
			}
		})();
	}, [ publicClient ]);

	// Auto refresh when we already have key + registration
	useEffect(() => {
		(async () => {
			if (!isConnected || !isDecryptionKeySet || !isRegistered) return;
			await refetchBalance();
			await new Promise((r) => setTimeout(r, 250));
		})();
	}, [ isConnected, isDecryptionKeySet, isRegistered, refetchBalance ]);

	// Connect / Disconnect
	const connectWith = useCallback(async (connectorId: string) => {
		const c = connectors.find((x) => x.id === connectorId);
		if (!c) return toast.error("Connector not available");
		try {
			const res = await connectAsync({ connector: c });
			localStorage.setItem("wagmi.lastUsedConnector", connectorId);
			toast.success(`Connected: ${ short(res.accounts?.[0] as Address) }`);
			if (res.chainId !== avalanche.id) {
				await switchChainAsync({ chainId: avalanche.id }).catch(() => {
					toast.warn("Please switch to Avalanche C-Chain");
				});
			}
		} catch (e) {
			toast.error((e as Error).message || "Failed to connect wallet");
			setShowConnect(true);
		}
	}, [ connectAsync, connectors, switchChainAsync ]);

	const handleDisconnect = useCallback(() => {
		disconnect();
		localStorage.removeItem("wagmi.lastUsedConnector");
		toast.info("Wallet disconnected");
	}, [ disconnect ]);

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
	}, [ walletClient, switchChainAsync ]);

	/* ================== Allowance helper ================== */
	const ensureAllowance = useCallback(
		async (owner: Address, spender: Address, amount: bigint) => {
			if (!publicClient || !walletClient) throw new Error("No client");

			const current: bigint = await publicClient.readContract({
				address: BURRITO_TOKEN, abi: ERC20_APPROVE_ABI, functionName: "allowance", args: [ owner, spender ],
			});
			if (current >= amount) return { approved: true, hash: "" as `0x${ string }` };

			const sendApprove = async (value: bigint) => {
				const hash = await walletClient.writeContract({
					address: BURRITO_TOKEN, abi: ERC20_APPROVE_ABI, functionName: "approve",
					args: [ spender, value ], account: owner,
				});
				await publicClient.waitForTransactionReceipt({ hash });
				return hash;
			};

			try {
				toast.info("Sending ERC‑20 approve…");
				const h = await sendApprove(amount);
				toast.success(<>Approve sent<br /><small>{ h }</small></>);
				return { approved: true, hash: h };
			} catch (e1) {
				// Reset-to-zero → approve exact (USDT-style)
				try {
					await sendApprove(0n);
				} catch {
					throw e1;
				}
				const h = await sendApprove(amount);
				toast.success(<>Approve sent<br /><small>{ h }</small></>);
				return { approved: true, hash: h };
			}
		},
		[ publicClient, walletClient ]
	);

	/* ================== Actions ================== */

	const handleGenerateKey = useCallback(async () => {
		if (!isConnected) return toast.error("Connect your wallet first");
		try {
			const ok = await ensureNetwork();
			if (!ok) return toast.warn("Please switch to Avalanche C-Chain");
			const key = await generateDecryptionKey();
			console.log("[BPF] key generated:", key ? "ok" : "??");
			toast.success("Decryption key generated");
			await refetchBalance();
		} catch (e) {
			toast.error((e as Error).message || "Failed to generate key");
		}
	}, [ isConnected, ensureNetwork, generateDecryptionKey, refetchBalance ]);

	const handleRegister = useCallback(async () => {
		if (!isConnected) return toast.error("Connect your wallet first");
		try {
			const ok = await ensureNetwork();
			if (!ok) return toast.warn("Please switch to Avalanche C-Chain");
			const { transactionHash } = await register();
			toast.success(<>Registration sent<br /><small>{ transactionHash }</small></>);
			await refetchBalance();
		} catch (e) {
			toast.error((e as Error).message || "Registration failed");
		}
	}, [ isConnected, ensureNetwork, register, refetchBalance ]);

	// Deposit: require key + registration for a clean UX
	const handleDeposit = useCallback(async () => {
		if (!isConnected || !address) return toast.error("Connect your wallet first");
		if (!amountDeposit || Number(amountDeposit) <= 0) return toast.error("Enter a valid amount");
		if (!isDecryptionKeySet) return toast.error("Generate your decryption key first");
		if (!isRegistered) return toast.error("Register first");

		// Non-blocking warning if there is no auditor set yet
		const hasAuditor =
			Array.isArray(auditorPkFromHook) &&
			auditorPkFromHook.length >= 2 &&
			(auditorPkFromHook[0] !== 0n || auditorPkFromHook[1] !== 0n);
		if (!hasAuditor) {
			toast.warn("No auditor set yet. You can deposit, but private transfers/withdraw may be blocked until an auditor is configured.");
		}

		try {
			const ok = await ensureNetwork();
			if (!ok) return toast.warn("Please switch to Avalanche C-Chain");
			setIsLoading(true);

			const atomic18 = parseUnits(amountDeposit, erc20Decimals);
			await ensureAllowance(address as Address, EERC_CONTRACT, atomic18);

			const { transactionHash } = await deposit(atomic18);
			setTxHash(transactionHash as `0x${ string }`);
			toast.success(<>Deposit submitted<br /><small>{ transactionHash }</small></>);

			await refetchBalance();
			await new Promise((r) => setTimeout(r, 300));
		} catch (e) {
			toast.error((e as Error).message || "Deposit failed");
		} finally {
			setIsLoading(false);
		}
	}, [
		isConnected, address, amountDeposit, isDecryptionKeySet, isRegistered,
		ensureNetwork, erc20Decimals, ensureAllowance, deposit, refetchBalance, auditorPkFromHook
	]);

	const handlePrivateTransfer = useCallback(async () => {
		if (!isConnected || !address) return toast.error("Connect your wallet first");
		if (!isDecryptionKeySet) return toast.error("Generate your decryption key first");
		if (!toPriv) return toast.error("Enter a recipient address");
		if (!amountPriv || Number(amountPriv) <= 0) return toast.error("Enter a valid amount");

		try {
			const ok = await ensureNetwork();
			if (!ok) return toast.warn("Please switch to Avalanche C-Chain");

			const reg = await isAddressRegistered(toPriv as Address);
			if (!reg?.isRegistered) return toast.error("Recipient is not registered in eERC");

			await refetchBalance();
			await new Promise((r) => setTimeout(r, 200));
			const before = lastPrivAtomicRef.current;
			const atomic = parseUnits(amountPriv, eercDecimals);

			const { transactionHash } = await privateTransfer(toPriv as Address, atomic);
			toast.success(<>Private transfer sent<br /><small>{ transactionHash }</small></>);

			await refetchBalance();
			await new Promise((r) => setTimeout(r, 300));
			const after = lastPrivAtomicRef.current;
			console.log("[BPF][privateTransfer] Δ:", (after - before).toString());
		} catch (e) {
			toast.error((e as Error).message || "Private transfer failed");
		}
	}, [ isConnected, address, isDecryptionKeySet, toPriv, amountPriv, ensureNetwork, isAddressRegistered, refetchBalance, eercDecimals, privateTransfer ]);

	const handleWithdraw = useCallback(async () => {
		if (!isConnected || !address) return toast.error("Connect your wallet first");
		if (!isDecryptionKeySet) return toast.error("Generate your decryption key first");
		if (!amountWithdraw || Number(amountWithdraw) <= 0) return toast.error("Enter a valid amount");

		try {
			const ok = await ensureNetwork();
			if (!ok) return toast.warn("Please switch to Avalanche C-Chain");

			await refetchBalance();
			await new Promise((r) => setTimeout(r, 200));
			const before = lastPrivAtomicRef.current;

			const atomic = parseUnits(amountWithdraw, eercDecimals);
			const t0 = performance.now();
			const { transactionHash } = await withdraw(atomic);
			const dt = Math.round(performance.now() - t0);
			console.log("[BPF][withdraw] proof+send(ms):", dt);

			toast.success(<>Withdraw sent<br /><small>{ transactionHash }</small></>);

			await refetchBalance();
			await new Promise((r) => setTimeout(r, 300));
			const after = lastPrivAtomicRef.current;
			console.log("[BPF][withdraw] Δ:", (after - before).toString());
		} catch (e: any) {
			toast.error(e?.shortMessage || e?.message || "Withdraw failed");
		}
	}, [ isConnected, address, isDecryptionKeySet, amountWithdraw, ensureNetwork, refetchBalance, eercDecimals, withdraw ]);

	// Simple refresh for the visible balance
	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await refetchBalance();
			await new Promise((r) => setTimeout(r, 250));
		} finally {
			setIsRefreshing(false);
		}
	}, [ refetchBalance ]);

	/* ================== UI ================== */
	const wrongNetwork = isConnected && chainId !== avalanche.id;
	const isProcessing = isConnecting || isSwitchingChain || connectStatus === "pending";

	return (
		<div className="bpf-wrapper">
			<div className="bpf-card">
				<header className="bpf-header" aria-label="Brand and wallet">
					{/* Avalanche logo (inline SVG) */ }
					<div className="logo-avalanche" aria-hidden>
						<svg viewBox="0 0 100 100" width="20" height="20" role="img">
							<title>Avalanche</title>
							<circle cx="50" cy="50" r="50" fill="#E84142" />
							<path
								d="M53 22l23 41c2 3 0 7-4 7H28c-4 0-6-4-4-7l23-41c2-4 7-4 9 0zM58 63h11L58 44l-5 9 5 10z"
								fill="#fff"
							/>
						</svg>
					</div>

					{/* Burrito “logo” */ }
					<div className="bpf-title">
						<h2>🌯 Burrito — Private Wallet</h2>
						<p>Encrypted ERC‑20 · Avalanche C‑Chain</p>
					</div>

					<div className="bpf-spacer" />

					{ !isConnected ? (
						<button
							className="bpf-btn primary"
							onClick={ () => setShowConnect(true) }
							disabled={ isProcessing }
						>
							{ isProcessing ? "Connecting..." : "Connect Wallet" }
						</button>
					) : (
						<div className="bpf-wallet">
							<span className="bpf-pill">{ short(address as Address) }</span>
							<button
								className="bpf-icon"
								title="Disconnect"
								onClick={ handleDisconnect }
								aria-label="Disconnect"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
									<path d="M16 13v-2H7V8l-5 4 5 4v-3h9zm3-12H9c-1.1 0-2 .9-2 2v4h2V3h10v18H9v-4H7v4c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2z" />
								</svg>
							</button>
						</div>
					) }
				</header>

				{ wrongNetwork && (
					<div className="bpf-alert" role="status" aria-live="polite">
						You are on the wrong network.&nbsp;
						<button
							className="bpf-btn tiny"
							onClick={ () => void ensureNetwork() }
							disabled={ isSwitchingChain }
						>
							{ isSwitchingChain ? "Switching..." : "Switch to Avalanche C‑Chain" }
						</button>
					</div>
				) }

				{/* Actions */ }
				<div className="bpf-grid">
					<div className="bpf-field">
						<label>Request ID (RID)</label>
						<input value={ rid } readOnly />
					</div>

					<div className="bpf-field">
						<label>ERC‑20 (public) → e.BURRITO (private)</label>
						<div className="bpf-row">
							<input
								inputMode="decimal"
								value={ amountDeposit }
								onChange={ (e) => setAmountDeposit(e.target.value) }
								placeholder="Amount to deposit"
							/>
							<button
								className="bpf-btn"
								onClick={ () => void handleDeposit() }
								disabled={ !amountDeposit || isLoading }
							>
								{ isLoading ? "Processing…" : "Deposit" }
							</button>
						</div>
						<small className="bpf-muted">ERC‑20 decimals: { erc20Decimals } • Private decimals: { eercDecimals }</small>
					</div>
				</div>

				<div className="bpf-grid" style={ { marginTop: 10 } }>
					<div className="bpf-field">
						<label>Private transfer (recipient must be registered)</label>
						<input
							value={ toPriv }
							onChange={ (e) => setToPriv(e.target.value as Address) }
							placeholder="Recipient (0x…)"
						/>
						<div className="bpf-row" style={ { marginTop: 6 } }>
							<input
								inputMode="decimal"
								value={ amountPriv }
								onChange={ (e) => setAmountPriv(e.target.value) }
								placeholder="Amount (e.BURRITO)"
							/>
							<button
								className="bpf-btn"
								onClick={ () => void handlePrivateTransfer() }
								disabled={ !amountPriv || !toPriv }
							>
								Send privately
							</button>
						</div>
					</div>

					<div className="bpf-field">
						<label>e.BURRITO (private) → ERC‑20 (public)</label>
						<div className="bpf-row">
							<input
								inputMode="decimal"
								value={ amountWithdraw }
								onChange={ (e) => setAmountWithdraw(e.target.value) }
								placeholder="Amount to withdraw"
							/>
							<button
								className="bpf-btn"
								onClick={ () => void handleWithdraw() }
								disabled={ !amountWithdraw }
							>
								Withdraw
							</button>
						</div>
					</div>
				</div>

				<hr className="bpf-sep" />

				{/* Balance: HIDDEN until the user has a decryption key */ }
				<section className="bpf-balance" aria-live="polite">
					<h3>🔐 Private balance</h3>

					{ !isDecryptionKeySet ? (
						<div className="bpf-alert small">
							Your private balance is encrypted. Generate your decryption key to view it.
						</div>
					) : (
						<>
              <p className="bpf-balance-num"><strong>{ privTokens }</strong> e.BURRITO</p>
              <div className="bpf-actions">
                <button className="bpf-btn ghost" onClick={ () => void handleRefresh() } disabled={ isRefreshing }>
                  { isRefreshing ? "Refreshing…" : "Refresh" }
                </button>
              </div>
            </>
					) }

					<div className="bpf-actions" style={ { marginTop: 12 } }>
						<button
							className="bpf-btn"
							onClick={ () => void handleGenerateKey() }
							disabled={ !isConnected || isDecryptionKeySet }
							title="Generate a local decryption key"
						>
							{ isDecryptionKeySet ? "✓ Decryption key ready" : "Generate key" }
						</button>
						<button
							className="bpf-btn"
							onClick={ () => void handleRegister() }
							disabled={ !isConnected || !isDecryptionKeySet || isRegistered }
							title="Register your public key on-chain"
						>
							{ isRegistered ? "✓ Registered" : "Register" }
						</button>
					</div>
				</section>

				{ txHash && (
					<>
            <hr className="bpf-sep" />
            <section>
              <h4>🧾 Last transaction</h4>
              <code className="bpf-code">{ txHash }</code>{ " " }
				<a
					href={ `https://snowtrace.io/tx/${ txHash }` }
					target="_blank"
					rel="noreferrer noopener"
					style={ { color: "#5ae59a" } }
				>
                View on Snowtrace ↗
              </a>
            </section>
          </>
				) }
			</div>

			{/* Connect sheet */ }
			{ showConnect && (
				<div className="bpf-sheet" role="dialog" aria-modal="true" aria-label="Select a wallet">
					<div className="bpf-sheet-card">
						<div className="bpf-sheet-header">
							<h4>Connect Wallet</h4>
							<button className="bpf-icon" onClick={ () => setShowConnect(false) } aria-label="Close">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
									<path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.3-6.3 6.3-6.29z" />
								</svg>
							</button>
						</div>
						<div className="bpf-connectors">
							{ connectors.map((c) => (
								<button
									key={ c.uid }
									className="bpf-conn"
									onClick={ () => void connectWith(c.id) }
									title={ c.name }
								>
									<span className="bpf-conn-icon">🔌</span>
									<span>{ c.name }</span>
								</button>
							)) }
							{ connectError ? <p className="bpf-error">{ connectError.message }</p> : null }
						</div>
					</div>
				</div>
			) }

			{/* Styles */ }
			<style jsx>{ `
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
					background: linear-gradient(180deg, rgba(215, 93, 65, .06), rgba(240, 159, 51, .06)), var(--bg);
					font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
				}

				.bpf-card {
					width: 100%;
					max-width: 680px;
					background: linear-gradient(180deg, rgba(255, 255, 255, .02), rgba(0, 0, 0, .15)), var(--panel);
					border: 1px solid var(--border);
					border-radius: 14px;
					padding: 18px;
					box-shadow: 0 8px 40px rgba(0, 0, 0, .35);
				}

				.bpf-header {
					display: flex;
					align-items: center;
					gap: 10px;
					margin-bottom: 12px;
				}

				.logo-avalanche {
					display: grid;
					place-items: center;
					width: 24px;
					height: 24px;
				}

				.bpf-title h2 {
					margin: 0;
					font-size: 18px;
					letter-spacing: 0.3px;
				}

				.bpf-title p {
					margin: 2px 0 0;
					color: var(--muted);
					font-size: 12px;
				}

				.bpf-spacer {
					flex: 1;
				}

				.bpf-wallet {
					display: flex;
					align-items: center;
					gap: 8px;
				}

				.bpf-pill {
					background: #141414;
					border: 1px solid var(--border);
					border-radius: 999px;
					padding: 6px 10px;
					font-weight: 700;
					font-size: 12px;
				}

				.bpf-icon {
					appearance: none;
					background: #141414;
					border: 1px solid var(--border);
					color: var(--text);
					padding: 8px;
					border-radius: 10px;
					cursor: pointer;
					line-height: 0;
				}

				.bpf-icon:hover {
					border-color: var(--ring);
				}

				.bpf-alert {
					display: flex;
					align-items: center;
					gap: 10px;
					background: rgba(215, 93, 65, .12);
					border: 1px solid rgba(215, 93, 65, .35);
					color: #fbf7ee;
					padding: 10px 12px;
					border-radius: 10px;
					font-size: 13px;
					margin-bottom: 10px;
				}

				.bpf-alert.small {
					font-size: 12px;
					margin: 6px 0;
				}

				.bpf-grid {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 14px;
					margin-top: 12px;
				}

				@media (max-width: 680px) {
					.bpf-grid {
						grid-template-columns: 1fr;
					}
				}

				.bpf-field {
					display: flex;
					flex-direction: column;
					gap: 6px;
				}

				label {
					color: var(--muted);
					font-size: 12px;
				}

				input {
					appearance: none;
					background: #141414;
					color: var(--text);
					border: 1px solid var(--border);
					border-radius: 10px;
					padding: 10px 12px;
					outline: none;
					transition: border-color .2s, box-shadow .2s;
					width: 100%;
				}

				input[readonly] {
					color: #d0d0d0;
					background: #131313;
				}

				input:focus {
					border-color: var(--ring);
					box-shadow: 0 0 0 3px var(--ring);
				}

				.bpf-row {
					display: grid;
					grid-template-columns: 1fr auto;
					gap: 8px;
				}

				.bpf-actions {
					display: flex;
					flex-wrap: wrap;
					gap: 10px;
					margin-top: 10px;
				}

				.bpf-btn {
					appearance: none;
					border: 1px solid var(--border);
					background: #171717;
					color: var(--text);
					padding: 10px 14px;
					border-radius: 10px;
					cursor: pointer;
					transition: transform .06s ease, border-color .15s, background .15s;
					font-weight: 600;
					font-size: 13px;
				}

				.bpf-btn:hover:not(:disabled) {
					border-color: var(--ring);
					transform: translateY(-1px);
				}

				.bpf-btn:disabled {
					opacity: .6;
					cursor: not-allowed;
				}

				.bpf-btn.primary {
					background: linear-gradient(180deg, var(--brand1), #b9442b);
					border-color: rgba(215, 93, 65, .55);
				}

				.bpf-btn.ghost {
					background: #141414;
				}

				.bpf-muted {
					color: var(--muted);
					font-size: 12px;
					margin: 8px 0 0;
					display: inline-block;
				}

				.bpf-sep {
					border: none;
					border-top: 1px solid var(--border);
					margin: 16px 0;
				}

				.bpf-balance h3, section h4 {
					margin: 0 0 8px;
					font-size: 14px;
					color: #fbf7ee;
				}

				.bpf-balance-num {
					margin: 0 0 8px;
					font-size: 16px;
				}

				.bpf-sheet {
					position: fixed;
					inset: 0;
					background: rgba(0, 0, 0, .45);
					display: grid;
					place-items: center;
					z-index: 50;
				}

				.bpf-sheet-card {
					width: 100%;
					max-width: 420px;
					background: #121212;
					border: 1px solid var(--border);
					border-radius: 14px;
					padding: 14px;
					box-shadow: 0 8px 40px rgba(0, 0, 0, .45);
				}

				.bpf-sheet-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					margin-bottom: 8px;
				}

				.bpf-connectors {
					display: grid;
					gap: 8px;
				}

				.bpf-conn {
					display: flex;
					align-items: center;
					gap: 10px;
					border: 1px solid var(--border);
					background: #171717;
					color: var(--text);
					padding: 10px 12px;
					border-radius: 10px;
					cursor: pointer;
					text-align: left;
				}

				.bpf-conn:hover:not(:disabled) {
					border-color: var(--ring);
				}

				.bpf-conn-icon {
					width: 24px;
					height: 24px;
					display: grid;
					place-items: center;
					background: #141414;
					border-radius: 8px;
					border: 1px solid var(--border);
				}
			` }</style>
		</div>
	);
}
