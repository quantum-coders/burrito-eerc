// src/components/BurritoPrivateFunding.tsx
'use client'

/* eslint-disable no-console */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	useAccount,
	useChainId,
	useDisconnect,
	usePublicClient,
	useSwitchChain,
	useWalletClient,
} from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { formatUnits, parseUnits, type Address } from 'viem'
import {
	useEERC,
	type CompatiblePublicClient,
	type CompatibleWalletClient,
} from '@avalabs/eerc-sdk'
import { toast } from 'react-toastify'
import ConnectWalletBar from './ConnectWalletBar'
import { writeContract } from 'wagmi/actions'
import { wagmiConfig } from '../lib/wagmi'

const BURRITO_TOKEN: Address = '0xf65645a42609f6b44E2EC158A3Dc2b6CfC97093f'
const EERC_CONTRACT: Address = '0x2f1836b1a43B49CeF81B52a0C5b850d67030c020'

function getCircuitConfig() {
	const origin = typeof window !== 'undefined' ? window.location.origin : ''
	const base = origin ? `${ origin }/eerc` : '/eerc'
	return {
		registration: { wasm: `${ base }/registration.wasm`, zkey: `${ base }/registration.zkey` },
		transfer: { wasm: `${ base }/transfer.wasm`, zkey: `${ base }/transfer.zkey` },
		withdraw: { wasm: `${ base }/withdraw.wasm`, zkey: `${ base }/withdraw.zkey` },
		mint: { wasm: `${ base }/mint.wasm`, zkey: `${ base }/mint.zkey` },
		burn: { wasm: `${ base }/burn.wasm`, zkey: `${ base }/burn.zkey` },
	} as const
}

const ERC20_DECIMALS_ABI = [
	{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [ { type: 'uint8' } ] },
] as const

const ERC20_APPROVE_ABI = [
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [ { type: 'address' }, { type: 'address' } ],
		outputs: [ { type: 'uint256' } ],
	},
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [ { type: 'address' }, { type: 'uint256' } ],
		outputs: [ { type: 'bool' } ],
	},
] as const

export default function BurritoPrivateFunding() {
	const circuits = getCircuitConfig()

	const { address, isConnected, isConnecting } = useAccount()
	const chainId = useChainId()
	const publicClient = usePublicClient({ chainId: avalanche.id })
	const { data: walletClient } = useWalletClient()
	const { switchChain, isPending: isSwitchingChain } = useSwitchChain()
	const { disconnect } = useDisconnect()

	const [ amountDeposit, setAmountDeposit ] = useState('')
	const [ amountWithdraw, setAmountWithdraw ] = useState('')
	const [ toPriv, setToPriv ] = useState<Address | ''>('')
	const [ amountPriv, setAmountPriv ] = useState('')
	const [ rid ] = useState<string>(() =>
		typeof window !== 'undefined' && typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `rid-${ Math.random().toString(36).slice(2, 10) }`
	)
	const [ isLoading, setIsLoading ] = useState(false)
	const [ isRefreshing, setIsRefreshing ] = useState(false)
	const [ txHash, setTxHash ] = useState<`0x${ string }` | ''>('')

	const [ erc20Decimals, setErc20Decimals ] = useState<number>(18)

	const {
		isRegistered,
		isDecryptionKeySet,
		generateDecryptionKey,
		register,
		isAddressRegistered,
		useEncryptedBalance,
		auditorPublicKey: auditorPkFromHook,
	} = useEERC(
		publicClient as CompatiblePublicClient,
		walletClient as CompatibleWalletClient,
		EERC_CONTRACT,
		circuits as any
	)

	const eb = useEncryptedBalance(BURRITO_TOKEN)
	const { decryptedBalance, decimals, deposit, withdraw, privateTransfer, refetchBalance } = eb

	const lastPrivAtomicRef = useRef<bigint>(0n)
	useEffect(() => {
		lastPrivAtomicRef.current = decryptedBalance ?? 0n
	}, [ decryptedBalance ])

	const eercDecimals = useMemo(() => {
		const n = Number(decimals ?? 2n)
		return Number.isFinite(n) && n > 0 && n <= 36 ? n : 2
	}, [ decimals ])

	const privTokens = useMemo(
		() => formatUnits(decryptedBalance ?? 0n, eercDecimals),
		[ decryptedBalance, eercDecimals ]
	)

	useEffect(() => {
		;(async () => {
			if (!publicClient) return
			try {
				const d = await publicClient.readContract({
					address: BURRITO_TOKEN,
					abi: ERC20_DECIMALS_ABI,
					functionName: 'decimals',
				})
				const n = Number(d)
				setErc20Decimals(Number.isFinite(n) ? n : 18)
			} catch {
				setErc20Decimals(18)
			}
		})()
	}, [ publicClient ])

	const ready = isConnected && isDecryptionKeySet && isRegistered
	const wasReadyRef = useRef(false)
	useEffect(() => {
		if (!ready || wasReadyRef.current) return
		wasReadyRef.current = true
		;(async () => {
			try {
				await refetchBalance()
			} catch {
			}
		})()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ ready ])

	useEffect(() => {
		console.log('🌯 Burrito Debug:', {
			isConnected,
			address,
			chainId,
			hasWalletClient: !!walletClient,
			isConnecting,
		})
	}, [ isConnected, address, chainId, walletClient, isConnecting ])

	useEffect(() => {
		if (isConnected && chainId !== avalanche.id) {
			switchChain({ chainId: avalanche.id })
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ isConnected, chainId ])

	const ensureNetwork = useCallback(async () => {
		if (chainId === avalanche.id) return true
		try {
			await (async () => switchChain({ chainId: avalanche.id }))()
			return true
		} catch {
			return false
		}
	}, [ chainId, switchChain ])

	const ensureAllowance = useCallback(
		async (owner: Address, spender: Address, amount: bigint) => {
			if (!publicClient) throw new Error('No public client')
			const current: bigint = await publicClient.readContract({
				address: BURRITO_TOKEN,
				abi: ERC20_APPROVE_ABI,
				functionName: 'allowance',
				args: [ owner, spender ],
			})
			if (current >= amount) return { approved: true, hash: '' as `0x${ string }` }

			const sendApprove = async (value: bigint) => {
				const hash = await writeContract(wagmiConfig, {
					address: BURRITO_TOKEN,
					abi: ERC20_APPROVE_ABI,
					functionName: 'approve',
					args: [ spender, value ],
					account: owner,
					chainId: avalanche.id,
				})
				await publicClient.waitForTransactionReceipt({ hash })
				return hash as `0x${ string }`
			}

			try {
				toast.info('Sending ERC‑20 approve…')
				const h = await sendApprove(amount)
				toast.success(<div>Approve sent<br /><small>{ h }</small></div>)
				return { approved: true, hash: h }
			} catch (e1) {
				try {
					await sendApprove(0n)
				} catch {
					throw e1
				}
				const h = await sendApprove(amount)
				toast.success(<div>Approve sent<br /><small>{ h }</small></div>)
				return { approved: true, hash: h }
			}
		},
		[ publicClient ]
	)

	const handleGenerateKey = useCallback(async () => {
		if (!isConnected) return toast.error('Connect your wallet first')
		try {
			const ok = await ensureNetwork()
			if (!ok) return toast.warn('Please switch to Avalanche C‑Chain')
			await generateDecryptionKey()
			toast.success('Decryption key generated')
			await refetchBalance()
		} catch (e) {
			toast.error((e as Error).message || 'Failed to generate key')
		}
	}, [ isConnected, ensureNetwork, generateDecryptionKey, refetchBalance ])

	const handleRegister = useCallback(async () => {
		if (!isConnected) return toast.error('Connect your wallet first')
		try {
			const ok = await ensureNetwork()
			if (!ok) return toast.warn('Please switch to Avalanche C‑Chain')
			const { transactionHash } = await register()
			toast.success(<div>Registration submitted<br /><small>{ transactionHash }</small></div>)
			setTxHash(transactionHash as `0x${ string }`)
			await refetchBalance()
		} catch (e) {
			toast.error((e as Error).message || 'Registration failed')
		}
	}, [ isConnected, ensureNetwork, register, refetchBalance ])

	const handleDeposit = useCallback(async () => {
		if (!isConnected || !address) return toast.error('Connect your wallet first')
		if (!amountDeposit || Number(amountDeposit) <= 0) return toast.error('Enter a valid amount')
		if (!isDecryptionKeySet) return toast.error('Generate your decryption key first')
		if (!isRegistered) return toast.error('Register first')

		const auditorSet =
			Array.isArray(auditorPkFromHook) &&
			auditorPkFromHook.length >= 2 &&
			(auditorPkFromHook[0] !== 0n || auditorPkFromHook[1] !== 0n)
		if (!auditorSet) {
			toast.warn('No auditor configured yet. You can deposit now, but private transfers/withdrawals may require an auditor.')
		}

		try {
			const ok = await ensureNetwork()
			if (!ok) return toast.warn('Please switch to Avalanche C‑Chain')
			setIsLoading(true)

			const atomic18 = parseUnits(amountDeposit, erc20Decimals)
			await ensureAllowance(address as Address, EERC_CONTRACT, atomic18)

			const { transactionHash } = await deposit(atomic18)
			setTxHash(transactionHash as `0x${ string }`)
			toast.success(<div>Deposit submitted<br /><small>{ transactionHash }</small></div>)
			await refetchBalance()
		} catch (e) {
			toast.error((e as Error).message || 'Deposit failed')
		} finally {
			setIsLoading(false)
		}
	}, [
		isConnected, address, amountDeposit, isDecryptionKeySet, isRegistered,
		ensureNetwork, erc20Decimals, ensureAllowance, deposit, refetchBalance, auditorPkFromHook
	])

	const handlePrivateTransfer = useCallback(async () => {
		if (!isConnected || !address) return toast.error('Connect your wallet first')
		if (!isDecryptionKeySet) return toast.error('Generate your decryption key first')
		if (!toPriv) return toast.error('Enter a recipient address')
		if (!amountPriv || Number(amountPriv) <= 0) return toast.error('Enter a valid amount')

		try {
			const ok = await ensureNetwork()
			if (!ok) return toast.warn('Please switch to Avalanche C‑Chain')
			const reg = await isAddressRegistered(toPriv as Address)
			if (!reg?.isRegistered) return toast.error('Recipient is not registered in eERC')

			const atomic = parseUnits(amountPriv, eercDecimals)
			const { transactionHash } = await privateTransfer(toPriv as Address, atomic)
			setTxHash(transactionHash as `0x${ string }`)
			toast.success(<div>Private transfer sent<br /><small>{ transactionHash }</small></div>)
			await refetchBalance()
		} catch (e) {
			toast.error((e as Error).message || 'Private transfer failed')
		}
	}, [ isConnected, address, isDecryptionKeySet, toPriv, amountPriv, ensureNetwork, isAddressRegistered, refetchBalance, eercDecimals, privateTransfer ])

	const handleWithdraw = useCallback(async () => {
		if (!isConnected || !address) return toast.error('Connect your wallet first')
		if (!isDecryptionKeySet) return toast.error('Generate your decryption key first')
		if (!amountWithdraw || Number(amountWithdraw) <= 0) return toast.error('Enter a valid amount')

		try {
			const ok = await ensureNetwork()
			if (!ok) return toast.warn('Please switch to Avalanche C‑Chain')
			const atomic = parseUnits(amountWithdraw, eercDecimals)
			const { transactionHash } = await withdraw(atomic)
			setTxHash(transactionHash as `0x${ string }`)
			toast.success(<div>Withdrawal sent<br /><small>{ transactionHash }</small></div>)
			await refetchBalance()
		} catch (e: unknown) {
			const err = e as { shortMessage?: string; message?: string }
			toast.error(err?.shortMessage || err?.message || 'Withdrawal failed')
		}
	}, [ isConnected, address, isDecryptionKeySet, amountWithdraw, ensureNetwork, refetchBalance, eercDecimals, withdraw ])

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true)
		try {
			await refetchBalance()
		} finally {
			setIsRefreshing(false)
		}
	}, [ refetchBalance ])

	const wrongNetwork = isConnected && chainId !== avalanche.id

	return (
		<div className="bpf-wrapper">
			<div className="bpf-card">
				<header className="bpf-header" aria-label="Brand and wallet">
					<div className="logo-avalanche" aria-hidden>
						<svg viewBox="0 0 100 100" width="22" height="22" role="img">
							<title>Avalanche</title>
							<circle cx="50" cy="50" r="50" fill="#E84142" />
							<path
								d="M53 22l23 41c2 3 0 7-4 7H28c-4 0-6-4-4-7l23-41c2-4 7-4 9 0zM58 63h11L58 44l-5 9 5 10z"
								fill="#fff"
							/>
						</svg>
					</div>

					<div className="bpf-title">
						<h2>🌯 Burrito — Private Wallet</h2>
						<p>Encrypted ERC‑20 · Avalanche C‑Chain</p>
					</div>

					<div className="bpf-spacer" />
					<ConnectWalletBar />
				</header>

				{ wrongNetwork && (
					<div className="bpf-alert" role="status" aria-live="polite">
						You are on the wrong network.&nbsp;
						<button
							type="button"
							className="bpf-btn tiny"
							onClick={ () => void switchChain({ chainId: avalanche.id }) }
							disabled={ isSwitchingChain }
						>
							{ isSwitchingChain ? 'Switching…' : 'Switch to Avalanche C‑Chain' }
						</button>
					</div>
				) }

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
								type="button"
								className="bpf-btn"
								onClick={ () => void handleDeposit() }
								disabled={ !amountDeposit || isLoading }
							>
								{ isLoading ? 'Processing…' : 'Deposit' }
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
								type="button"
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
								type="button"
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

				<section className="bpf-balance" aria-live="polite">
					<h3>🔐 Private balance</h3>
					{ !isDecryptionKeySet ? (
						<div className="bpf-alert small">Your private balance is encrypted. Generate your decryption key to view it.</div>
					) : (
						<>
              <p className="bpf-balance-num"><strong>{ privTokens }</strong> e.BURRITO</p>
              <div className="bpf-actions">
                <button
					type="button"
					className="bpf-btn ghost"
					onClick={ () => void handleRefresh() }
					disabled={ isRefreshing }
				>
                  { isRefreshing ? 'Refreshing…' : 'Refresh' }
                </button>
              </div>
            </>
					) }

					<div className="bpf-actions" style={ { marginTop: 12 } }>
						<button
							type="button"
							className="bpf-btn"
							onClick={ () => void handleGenerateKey() }
							disabled={ !isConnected || isDecryptionKeySet }
							title="Generate a local decryption key"
						>
							{ isDecryptionKeySet ? '✓ Decryption key ready' : 'Generate key' }
						</button>
						<button
							type="button"
							className="bpf-btn"
							onClick={ () => void handleRegister() }
							disabled={ !isConnected || !isDecryptionKeySet || isRegistered }
							title="Register your public key on-chain"
						>
							{ isRegistered ? '✓ Registered' : 'Register' }
						</button>
					</div>
				</section>

				{ txHash && (
					<>
            <hr className="bpf-sep" />
            <section>
              <h4>🧾 Last transaction</h4>
              <code className="bpf-code">{ txHash }</code>{ ' ' }
				<a
					href={ `https://snowtrace.io/tx/${ txHash }` }
					target="_blank"
					rel="noreferrer noopener"
					style={ { color: '#5ae59a' } }
				>
                View on Snowtrace ↗
              </a>
            </section>
          </>
				) }
			</div>

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
					max-width: 720px;
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
					grid-template-columns:1fr 1fr;
					gap: 14px;
					margin-top: 12px;
				}

				@media (max-width: 680px) {
					.bpf-grid {
						grid-template-columns:1fr;
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
					grid-template-columns:1fr auto;
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

				.bpf-btn.tiny {
					padding: 6px 10px;
					font-size: 12px;
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

				.bpf-code {
					font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
					background: #0a0a0a;
					padding: 2px 6px;
					border-radius: 4px;
					font-size: 12px;
				}
			` }</style>
		</div>
	)
}
