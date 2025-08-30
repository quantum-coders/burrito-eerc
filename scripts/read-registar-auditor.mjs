#!/usr/bin/env node
import { config as dotenv } from 'dotenv';
import { createPublicClient, http, isAddress, parseAbi } from 'viem';

dotenv({ path: '.env' });
dotenv({ path: '.env.local', override: true });

const { RPC_URL, EERC_CONTRACT } = process.env;
if (!RPC_URL || !EERC_CONTRACT) {
  console.error('Missing RPC_URL or EERC_CONTRACT in env');
  process.exit(1);
}
if (!isAddress(EERC_CONTRACT)) {
  console.error('EERC_CONTRACT is not a valid address');
  process.exit(1);
}

const pub = createPublicClient({ transport: http(RPC_URL) });

const EERC_ABI = parseAbi([
  'function registrar() view returns (address)',
  'function auditor() view returns (address)',
  'function auditorPublicKey() view returns (uint256 x, uint256 y)',
  'function isAuditorKeySet() view returns (bool)'
]);

const REG_ABI = parseAbi([
  'function isUserRegistered(address) view returns (bool)',
  'function getUserPublicKey(address) view returns (uint256[2])'
]);

(async () => {
  console.log('🔎 eERC =', EERC_CONTRACT);
  const registrar = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'registrar' });
  console.log('🔗 Registrar =', registrar);

  const auditor = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditor' });
  const [ax, ay] = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'auditorPublicKey' });
  const ready = await pub.readContract({ address: EERC_CONTRACT, abi: EERC_ABI, functionName: 'isAuditorKeySet' });

  console.log('👤 auditor(address) =', auditor);
  console.log('🔑 auditorPublicKey =', ax.toString(), ay.toString());
  console.log('✅ isAuditorKeySet  =', ready);
})();
