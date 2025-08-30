#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import * as circomlibjs from "circomlibjs";

try {
  const babyJub = await circomlibjs.buildBabyjub();
  const eddsa   = await circomlibjs.buildEddsa();
  const F       = babyJub.F;

  const sk  = randomBytes(32);      // NO GUARDES esto en prod
  const pub = eddsa.prv2pub(sk);    // [Ax, Ay] en campo

  const Ax = F.toObject(pub[0]);
  const Ay = F.toObject(pub[1]);

  console.log("=== Auditor Key (Dev / Null Auditor) ===");
  console.log("AUDITOR_AX (dec):", Ax.toString());
  console.log("AUDITOR_AY (dec):", Ay.toString());
  console.log("AUDITOR_AX (hex):", "0x" + Ax.toString(16));
  console.log("AUDITOR_AY (hex):", "0x" + Ay.toString(16));
  console.log("\nSK (hex) — BORRAR/NO GUARDAR:", "0x" + sk.toString("hex"));
  console.log("\nTip:");
  console.log("export AUDITOR_AX=" + Ax.toString());
  console.log("export AUDITOR_AY=" + Ay.toString());
} catch (e) {
  console.error("Failed to generate auditor key:", e?.message || e);
  process.exit(1);
}
