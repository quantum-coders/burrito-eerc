// src/components/ConnectWalletBar.tsx
'use client'

import React, { useEffect, useState } from 'react'
import { useAccount, useDisconnect, useSwitchChain, useChainId, useConnections } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import s from './ConnectWalletBar.module.css'

const short = (addr?: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '')

export default function ConnectWalletBar() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, status } = useAccount()
  const chainId = useChainId()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const activeConnections = useConnections()

  const openModal = () => {
    console.log('[ConnectWalletBar] Connect clicked → dispatch open')
    window.dispatchEvent(new CustomEvent('walletmodal:open'))
  }

  if (!mounted) {
    return (
      <div className={s.bar}>
        <button type="button" className={`${s.btn} ${s.secondary}`} disabled>
          Connect
        </button>
      </div>
    )
  }

  if (status === 'connected') {
    const active = activeConnections[0]?.connector
    const name = active?.name ?? 'Wallet'
    const onAvalanche = chainId === avalanche.id

    return (
      <div className={s.bar}>
        <span className={s.pill} title={name}>{name}</span>
        <span className={`${s.pill} ${s.addr}`} title={address}>{short(address)}</span>

        {!onAvalanche ? (
          <button
            type="button"
            className={`${s.btn} ${s.primary}`}
            onClick={() => switchChain({ chainId: avalanche.id })}
            disabled={isSwitching}
            title="Switch to Avalanche C‑Chain"
          >
            {isSwitching ? 'Switching…' : 'Avalanche'}
          </button>
        ) : null}

        <button type="button" className={`${s.btn} ${s.secondary}`} onClick={openModal}>
          Change
        </button>
        <button type="button" className={`${s.btn} ${s.danger}`} onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className={s.bar}>
      <button
        id="connect-wallet-btn"
        type="button"
        className={`${s.btn} ${s.primary}`}
        onClick={openModal}
      >
        Connect Wallet
      </button>
    </div>
  )
}
