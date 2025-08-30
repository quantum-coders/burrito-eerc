// src/lib/eerc.ts
import { avalanche } from "wagmi/chains";

export const EERC_CHAIN_ID = avalanche.id; // 43114

export const BURRITO_TOKEN = "0xf65645a42609f6b44E2EC158A3Dc2b6CfC97093f" as const;

// 👉 el ultimo deploy que mostraste:
export const EERC_CONTRACT = "0x2f1836b1a43B49CeF81B52a0C5b850d67030c020" as const;

export function getCircuitConfig() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = origin ? `${origin}/eerc` : "/eerc";
  return {
    registration: { wasm: `${base}/registration.wasm`, zkey: `${base}/registration.zkey` },
    transfer:     { wasm: `${base}/transfer.wasm`,     zkey: `${base}/transfer.zkey` },
    withdraw:     { wasm: `${base}/withdraw.wasm`,     zkey: `${base}/withdraw.zkey` },
    mint:         { wasm: `${base}/mint.wasm`,         zkey: `${base}/mint.zkey` },
    burn:         { wasm: `${base}/burn.wasm`,         zkey: `${base}/burn.zkey` },
  } as const;
}
