// src/components/WalletModalRoot.tsx
'use client'

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useConnect } from 'wagmi'
import { avalanche } from 'wagmi/chains'

const STYLES = `
  dialog.wallet-modal {
    width: min(92vw, 620px);
    border: 1px solid rgba(255,255,255,.10);
    border-radius: 16px;
    padding: 0;
    color: #f5f5f5;
    background:
      linear-gradient(180deg, rgba(215,93,65,.08), rgba(240,159,51,.08)),
      rgba(14,14,14,1);
    box-shadow: 0 24px 80px rgba(0,0,0,.55);
  }
  dialog.wallet-modal::backdrop {
    background: radial-gradient(1200px 600px at 50% -10%, rgba(215,93,65,.25), transparent 40%),
                rgba(0,0,0,.60);
    backdrop-filter: blur(2px);
  }

  .hdr {
    display:flex; align-items:center; gap:10px; justify-content:space-between;
    padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .brand { display:flex; align-items:center; gap:10px; }
  .chip {
    display:grid; place-items:center; width:28px; height:28px; border-radius:8px;
    background: linear-gradient(180deg, #E84142, #c23334);
    border: 1px solid rgba(255,255,255,.12);
  }
  .chip svg { display:block }
  .title { font-weight:800; font-size:16px; letter-spacing:.2px; }
  .subtitle { color:#b9b9b9; font-size:12px; margin-top:2px; }

  .close {
    appearance:none; border:1px solid rgba(255,255,255,.12);
    background:#171717; color:#f5f5f5; border-radius:10px; padding:8px 10px;
    cursor:pointer; font-weight:600; transition: border-color .15s, transform .06s ease;
  }
  .close:hover { border-color: rgba(215,93,65,.45); transform: translateY(-1px); }

  .body { padding: 14px 16px 16px; }

  .sec {
    background: rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.10);
    border-radius: 14px; padding: 12px; margin: 12px 0;
  }
  .label { color:#a8a8a8; font-size:12px; margin-bottom:10px; }

  .cards { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 560px) { .cards { grid-template-columns: 1fr; } }

  .card {
    appearance:none; width:100%;
    border:1px solid rgba(255,255,255,.10);
    background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(0,0,0,.12));
    color:#f5f5f5; padding: 12px; border-radius: 12px; cursor:pointer; text-align:left;
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    transition: transform .08s ease, border-color .15s, background .15s, box-shadow .15s;
  }
  .card:hover {
    border-color: rgba(215,93,65,.45);
    transform: translateY(-1px);
    box-shadow: 0 8px 26px rgba(0,0,0,.35);
  }
  .card:disabled { opacity:.6; cursor:not-allowed; }

  .cardL { display:flex; align-items:center; gap:10px; }

  .iconWrap {
    position:relative; width:36px; height:36px; border-radius:10px;
    display:grid; place-items:center; background:#111; border:1px solid rgba(255,255,255,.12);
  }
  .iconWrap img { width:22px; height:22px; display:block; }
  .fallbackEmoji { position:absolute; inset:0; display:grid; place-items:center; font-size:16px; }

  .names { display:flex; flex-direction:column; }
  .name { font-weight:700; font-size:14px; }
  .hint { color:#bdbdbd; font-size:12px; }

  .right { display:flex; align-items:center; gap:8px; }
  .spin { width:14px; height:14px; border:2px solid rgba(255,255,255,.2); border-top-color:#fff; border-radius:50%;
    animation:spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .note, .err { font-size:12px; margin-top:8px; }
  .note { color:#bdbdbd; }
  .err { color:#ffb3b3; }

  .cta {
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    border:1px dashed rgba(255,255,255,.12); border-radius:12px; padding:12px;
    background: linear-gradient(180deg, rgba(255,255,255,.025), rgba(0,0,0,.08));
  }
  .ctaL { display:flex; align-items:center; gap:10px; }
  .ctaBtn {
    appearance:none; border:1px solid rgba(255,255,255,.12);
    background: linear-gradient(180deg, #d75d41, #b9442b);
    color:#fff; font-weight:700; padding:10px 12px; border-radius:10px; cursor:pointer;
    transition: transform .08s ease, border-color .15s;
  }
  .ctaBtn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.25); }
`

export default function WalletModalRoot() {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  // ---- GLOBAL open/close events (client-only in useEffect) ----
  useEffect(() => {
    console.log('[WalletModal] mounted')
    const onOpen = () => {
      console.log('[WalletModal] open event received')
      const d = dialogRef.current
      if (!d) return
      try {
        if (!d.open && typeof d.showModal === 'function') {
          d.showModal()
          console.log('[WalletModal] showModal() called')
          const prev = document.body.style.overflow
          document.body.dataset._prevOverflow = prev
          document.body.style.overflow = 'hidden'
        }
      } catch (e) {
        console.error('[WalletModal] showModal() failed', e)
      }
    }
    const onClose = () => {
      const d = dialogRef.current
      if (d?.open) d.close()
    }
    window.addEventListener('walletmodal:open', onOpen)
    window.addEventListener('walletmodal:close', onClose)
    return () => {
      window.removeEventListener('walletmodal:open', onOpen)
      window.removeEventListener('walletmodal:close', onClose)
    }
  }, [])

  // ---- Restore scroll when dialog closes ----
  const handleClose = useCallback(() => {
    const prev = document.body.dataset._prevOverflow ?? ''
    document.body.style.overflow = prev
    delete document.body.dataset._prevOverflow
  }, [])

  // ---- wagmi connect primitives ----
  const { connect, connectors, isPending, variables, error } = useConnect()
  const pendingConnectorId =
    variables?.connector && 'id' in variables.connector ? (variables.connector as any).id : undefined

  // ---- Split into installed (injected) & others ----
  const injected = useMemo(() => connectors.filter((c) => c.type === 'injected'), [connectors])
  const others = useMemo(() => connectors.filter((c) => c.type !== 'injected'), [connectors])

  // ✅ SSR-SAFE: compute hasInjected only on client
  const [hasInjected, setHasInjected] = useState(false)
  useEffect(() => {
    const eth = (typeof window !== 'undefined' ? (window as any).ethereum : undefined)
    setHasInjected(!!eth || Array.isArray(eth?.providers))
  }, [])

  // ---- Icons & fallbacks ----
  const getIconPath = (id: string, name: string): { src?: string; fallback: string; hint: string } => {
    const n = name.toLowerCase()
    if (id === 'walletConnect' || n.includes('walletconnect')) {
      return { src: '/icons/wallets/walletconnect.svg', fallback: '🔗', hint: 'Mobile & Desktop (QR)' }
    }
    if (id === 'coinbaseWallet' || n.includes('coinbase')) {
      return { src: '/icons/wallets/coinbase.svg', fallback: '🔵', hint: 'Coinbase Wallet' }
    }
    if (n.includes('metamask')) {
      return { src: '/icons/wallets/metamask.svg', fallback: '🦊', hint: 'Injected (browser)' }
    }
    if (id === 'injected') {
      return { src: '/icons/wallets/injected.svg', fallback: '🧩', hint: 'Injected (browser)' }
    }
    return { src: '/icons/wallets/injected.svg', fallback: '💼', hint: 'Wallet' }
  }

  const onImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    img.style.display = 'none'
    const wrap = img.closest('.iconWrap') as HTMLElement | null
    if (wrap) {
      const fb = wrap.querySelector('.fallbackEmoji') as HTMLElement | null
      if (fb) fb.style.display = 'grid'
    }
  }

  const onSelect = useCallback(
    async (id: string) => {
      try {
        const chosen = connectors.find((c) => c.id === id)
        if (!chosen) return
        await connect({ connector: chosen, chainId: avalanche.id })
        dialogRef.current?.close()
      } catch {
        // error is shown below
      }
    },
    [connect, connectors]
  )

  const onDialogClick: React.MouseEventHandler<HTMLDialogElement> = (e) => {
    const dialog = dialogRef.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    const inDialog =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom
    if (!inDialog) dialog.close()
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className="wallet-modal"
        onClose={handleClose}
        onCancel={handleClose}
        onClick={onDialogClick}
      >
        <div className="hdr">
          <div className="brand">
            <div className="chip" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="50" fill="#E84142" />
                <path d="M53 22l23 41c2 3 0 7-4 7H28c-4 0-6-4-4-7l23-41c2-4 7-4 9 0zM58 63h11L58 44l-5 9 5 10z" fill="#fff" />
              </svg>
            </div>
            <div>
              <div className="title">Connect a wallet</div>
              <div className="subtitle">Encrypted ERC‑20 · Avalanche C‑Chain</div>
            </div>
          </div>
          <button type="button" className="close" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>

        <div className="body">
          {/* Installed */}
          <div className="sec">
            <div className="label">Installed</div>

            {injected.length && hasInjected ? (
              <div className="cards">
                {injected.map((c) => {
                  const { src, fallback, hint } = getIconPath(c.id, c.name)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="card"
                      onClick={() => onSelect(c.id)}
                      disabled={isPending && pendingConnectorId === c.id}
                      title={c.name}
                    >
                      <div className="cardL">
                        <div className="iconWrap">
                          <img src={src} alt="" onError={onImgError} />
                          <span className="fallbackEmoji" style={{ display: 'none' }}>{fallback}</span>
                        </div>
                        <div className="names">
                          <span className="name">{c.name}</span>
                          <span className="hint">{hint}</span>
                        </div>
                      </div>
                      <div className="right">
                        {isPending && pendingConnectorId === c.id ? <span className="spin" /> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="cta">
                <div className="ctaL">
                  <div className="iconWrap">
                    <img src="/icons/wallets/metamask.svg" alt="" onError={onImgError} />
                    <span className="fallbackEmoji" style={{ display: 'none' }}>🦊</span>
                  </div>
                  <div>
                    <div className="name">Get MetaMask</div>
                    <div className="hint">Install a browser wallet to connect</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="ctaBtn"
                  onClick={() => window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer')}
                >
                  Install
                </button>
              </div>
            )}
          </div>

          {/* Other options */}
          {others.length > 0 && (
            <div className="sec">
              <div className="label">Other options</div>
              <div className="cards">
                {others.map((c) => {
                  const { src, fallback, hint } = getIconPath(c.id, c.name)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="card"
                      onClick={() => onSelect(c.id)}
                      disabled={isPending && pendingConnectorId === c.id}
                      title={c.name}
                    >
                      <div className="cardL">
                        <div className="iconWrap">
                          <img src={src} alt="" onError={onImgError} />
                          <span className="fallbackEmoji" style={{ display: 'none' }}>{fallback}</span>
                        </div>
                        <div className="names">
                          <span className="name">{c.name}</span>
                          <span className="hint">{hint}</span>
                        </div>
                      </div>
                      <div className="right">
                        {isPending && pendingConnectorId === c.id ? <span className="spin" /> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error ? <p className="err">Error: {error.message}</p> : null}
        </div>
      </dialog>

      <style jsx>{STYLES}</style>
    </>
  )
}
