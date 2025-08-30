#!/usr/bin/env node
import { config as dotenv } from 'dotenv';
import { createPublicClient, createWalletClient, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

dotenv({ path: '.env' });
dotenv({ path: '.env.local', override: true });

const {
  RPC_URL,
  EERC_CONTRACT,
  OWNER_PRIVATE_KEY,
  AUDITOR_ADDRESS
} = process.env;

function die(msg){ console.error(msg); process.exit(1); }

if (!RPC_URL || !EERC_CONTRACT || !OWNER_PRIVATE_KEY || !AUDITOR_ADDRESS) {
  die('Missing env. Need RPC_URL, EERC_CONTRACT, OWNER_PRIVATE_KEY, AUDITOR_ADDRESS');
}
if (!isAddress(EERC_CONTRACT)) die('EERC_CONTRACT not an address');
const auditorAddr = AUDITOR_ADDRESS.startsWith('0x') ? AUDITOR_ADDRESS : `0x${AUDITOR_ADDRESS}`;
if (!isAddress(auditorAddr)) die('AUDITOR_ADDRESS not an address');

const account = privateKeyToAccount(
  OWNER_PRIVATE_KEY.startsWith('0x') ? OWNER_PRIVATE_KEY : `0x${OWNER_PRIVATE_KEY}`
);
const pub = createPublicClient({ transport: http(RPC_URL) });
const wallet = createWalletClient({ transport: http(RPC_URL), account });

const EERC_ABI = parseAbi([
  'function owner() view returns (address)',
  'function registrar() view returns (address)',
  'function setAuditorPublicKey(address user)',
  'function auditor() view returns (address)',
  'function auditorPublicKey() view returns (uint256 x, uint256 y)',
  'function isAuditorKeySet() view returns (bool)'
]);

const REG_ABI = parseAbi([
  'function isUserRegistered(address) view returns (bool)',
  'function getUserPublicKey(address) view returns (uint256[2])'
]);

(async () => {
  console.log('=== Set eERC Auditor (ABI real) ===');
  console.log('Owner:', account.address);
  console.log('eERC :', EERC_CONTRACT);
  console.log('Aud  :', auditorAddr);

  // owner check (si existe)
  try {
    const owner = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'owner' });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      console.warn('⚠ Owner on-chain =', owner, '(tu cuenta NO es el owner). Es probable que la tx falle por Ownable.');
    }
  } catch {}

  const registrar = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'registrar' });
  console.log('Reg  :', registrar);

  // validar que el auditor esté registrado
  const isReg = await pub.readContract({ address: registrar, abi: REG_ABI, functionName: 'isUserRegistered', args: [auditorAddr] });
  const userPk = await pub.readContract({ address: registrar, abi: REG_ABI, functionName: 'getUserPublicKey', args: [auditorAddr] });
  console.log('✓ auditor registered?', isReg, 'PK =', userPk[0].toString(), userPk[1].toString());
  if (!isReg) die('❌ Auditor address NO está registrada en Registrar. Regístrala primero con la UI (Generate key + Register).');

  // estado previo
  const prevReady = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'isAuditorKeySet' });
  const prevAud   = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditor' });
  const [pAx, pAy] = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditorPublicKey' });
  console.log('Before -> ready:', prevReady, 'auditor:', prevAud, 'pk:', pAx.toString(), pAy.toString());

  // simular + enviar tx
  try {
    await pub.simulateContract({
      address: EERC_CONTRACT,
      abi: EERC_ABI,
      functionName: 'setAuditorPublicKey',
      args: [auditorAddr],
      account: account.address
    });
  } catch (e) {
    die('Simulate failed: ' + (e.shortMessage || e.message));
  }

  const hash = await wallet.writeContract({
    address: EERC_CONTRACT,
    abi: EERC_ABI,
    functionName: 'setAuditorPublicKey',
    args: [auditorAddr]
  });
  console.log('tx:', hash);

  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log('status:', rcpt.status);

  // verificar
  const ready = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'isAuditorKeySet' });
  const aud   = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditor' });
  const [ax, ay] = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditorPublicKey' });
  console.log('After  -> ready:', ready, 'auditor:', aud, 'pk:', ax.toString(), ay.toString());

  if (!ready) {
    console.error('❌ isAuditorKeySet sigue en false. Revisa que el owner sea correcto y que AUDITOR_ADDRESS esté registrada.');
    process.exit(1);
  }
  console.log('✅ Auditor configurado. Ya puedes depositar.');
})();
