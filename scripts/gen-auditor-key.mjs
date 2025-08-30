#!/usr/bin/env node
// Genera un "null-auditor": publica Ax/Ay y descarta la SK.
// Requiere Node >= 16 y "circomlibjs" instalada.

import { randomBytes } from "node:crypto";
import * as circomlibjs from "circomlibjs";

try {
  // Construir módulos (obligatorio en circomlibjs)
  const babyJub = await circomlibjs.buildBabyjub(); // -> { F, addPoint, ... }
  const eddsa   = await circomlibjs.buildEddsa();   // -> { prv2pub, signPoseidon, ... }
  const F       = babyJub.F;

  // SK aleatoria (no la guardes si quieres "null-auditor")
  const sk  = randomBytes(32);         // Buffer
  const pub = eddsa.prv2pub(sk);       // [Ax, Ay] (Field elements)

  // Convierte a BigInt "limpio"
  const Ax = F.toObject(pub[0]);       // BigInt
  const Ay = F.toObject(pub[1]);       // BigInt

  console.log("=== Auditor Key (Dev / Null Auditor) ===");
  console.log("AUDITOR_AX (dec):", Ax.toString());
  console.log("AUDITOR_AY (dec):", Ay.toString());
  console.log("AUDITOR_AX (hex):", "0x" + Ax.toString(16));
  console.log("AUDITOR_AY (hex):", "0x" + Ay.toString(16));
  console.log("\nSK (hex) — BORRAR/NO GUARDAR:", "0x" + sk.toString("hex"));
  console.log("\nTip: exporta estas variables para el script que setea el auditor en el Registrar:");
  console.log("export AUDITOR_AX=" + Ax.toString());
  console.log("export AUDITOR_AY=" + Ay.toString());
} catch (e) {
  console.error("Failed to generate auditor key:", e?.message || e);
  process.exit(1);
}
