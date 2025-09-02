// src/components/ProviderSelectModal.tsx
'use client'

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Connector } from 'wagmi'

type Props = {
	open: boolean
	onClose: () => void
	connectors: readonly Connector[]
	onSelect: (connectorId: string) => void
	isPending: boolean
	pendingConnectorId?: string
	hasInjected: boolean
	errorText?: string
}

const STYLES = `
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.55);
    display: grid; place-items: center;
    z-index: 2147483647; /* top */
  }
  .modal {
    width: min(92vw, 520px);
    background: #111; color: #f5f5f5;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 14px;
    box-shadow: 0 16px 56px rgba(0,0,0,.5);
    padding: 16px;
  }
  .hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .title { font-weight:700; font-size:16px; }
  .close {
    appearance:none; border:1px solid rgba(255,255,255,.12);
    background:#171717; color:#f5f5f5; border-radius:10px; padding:8px 10px; cursor:pointer;
  }
  .sec { background: rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:10px; margin:12px 0; }
  .label { color:#a8a8a8; font-size:12px; margin-bottom:8px; }
  .list { display:grid; gap:8px; }
  .btn {
    appearance:none; width:100%;
    border:1px solid rgba(255,255,255,.12); background:#171717; color:#f5f5f5;
    padding:10px 12px; border-radius:10px; cursor:pointer; font-weight:600; font-size:13px;
    display:flex; align-items:center; justify-content:space-between;
    transition: transform .06s ease, border-color .15s, background .15s;
  }
  .btn:hover { border-color: rgba(215,93,65,.45); transform: translateY(-1px); }
  .btn:disabled { opacity:.6; cursor:not-allowed; }
  .note, .err { font-size:12px; margin-top:6px; }
  .note { color:#bdbdbd; }
  .err { color:#ffb3b3; }
  .dot { width:8px; height:8px; border-radius:999px; background:#5ae59a; margin-right:8px; display:inline-block; }
  .row { display:flex; align-items:center; gap:8px; }
  .right { display:flex; align-items:center; gap:8px; }
  @media (max-width: 480px) { .modal { padding: 12px; } }
  .spin { width:14px; height:14px; border:2px solid rgba(255,255,255,.2); border-top-color:#fff; border-radius:50%; animation:spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`

export default function ProviderSelectModal({
												open,
												onClose,
												connectors,
												onSelect,
												isPending,
												pendingConnectorId,
												hasInjected,
												errorText,
											}: Props) {
	const canPortal = typeof window !== 'undefined'
	useEffect(() => {
		if (!open || !canPortal) return
		console.log('[WalletModal] open')
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		const prev = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('keydown', onKey)
			document.body.style.overflow = prev
		}
	}, [ open, onClose, canPortal ])

	if (!open || !canPortal) return null

	const injected = connectors.filter((c) => c.type === 'injected')
	const others = connectors.filter((c) => c.type !== 'injected')

	const content = (
		<div className="overlay" onClick={ onClose }>
			<div className="modal" role="dialog" aria-modal="true" onClick={ (e) => e.stopPropagation() }>
				<div className="hdr">
					<div className="title">Connect a wallet</div>
					<button type="button" className="close" onClick={ onClose }>Close</button>
				</div>

				<div className="sec">
					<div className="label">Installed</div>
					<div className="list">
						{ injected.length && hasInjected ? (
							injected.map((c) => (
								<button
									type="button"
									key={ c.id }
									className="btn"
									onClick={ () => onSelect(c.id) }
									disabled={ isPending && pendingConnectorId === c.id }
								>
									<span className="row"><span className="dot" />{ c.name }</span>
									<span className="right">{ isPending && pendingConnectorId === c.id ?
										<span className="spin" /> : null }</span>
								</button>
							))
						) : (
							<>
                <button
					type="button"
					className="btn"
					onClick={ () => window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer') }
				>
                  Get a browser wallet (MetaMask)
                </button>
                <p className="note">No injected wallet detected.</p>
              </>
						) }
					</div>
				</div>

				{ others.length > 0 && (
					<div className="sec">
						<div className="label">Other options</div>
						<div className="list">
							{ others.map((c) => (
								<button
									type="button"
									key={ c.id }
									className="btn"
									onClick={ () => onSelect(c.id) }
									disabled={ isPending && pendingConnectorId === c.id }
								>
									<span>{ c.name }</span>
									<span className="right">{ isPending && pendingConnectorId === c.id ?
										<span className="spin" /> : null }</span>
								</button>
							)) }
						</div>
					</div>
				) }

				{ errorText ? <p className="err">Error: { errorText }</p> : null }
			</div>
			<style jsx>{ STYLES }</style>
		</div>
	)

	return createPortal(content, document.body)
}
