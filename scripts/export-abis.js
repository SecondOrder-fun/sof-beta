#!/usr/bin/env node

/**
 * export-abis.js
 *
 * Reads Foundry build output from packages/contracts/out/,
 * extracts ABI arrays, writes individual JSON files to packages/contracts/abi/,
 * and generates abi/index.js with named exports.
 *
 * Usage: node scripts/export-abis.js
 * Called automatically by: npm run build --workspace=@sof/contracts
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contractsDir = path.join(__dirname, '..', 'packages', 'contracts', 'out');
const abiDir = path.join(__dirname, '..', 'packages', 'contracts', 'abi');

const CONTRACTS_TO_EXPORT = [
  // Core Raffle System
  { source: 'Raffle.sol/Raffle.json', name: 'Raffle' },
  { source: 'RafflePositionTracker.sol/RafflePositionTracker.json', name: 'RafflePositionTracker' },
  { source: 'RafflePrizeDistributor.sol/RafflePrizeDistributor.json', name: 'RafflePrizeDistributor' },
  { source: 'RaffleToken.sol/RaffleToken.json', name: 'RaffleToken' },

  // InfoFi Prediction Markets
  // InfoFiMarket.json is the FPMM instance ABI (SimpleFPMM V2), not compiled by Foundry.
  // Copied as-is from sof-alpha/src/contracts/abis/ during initial migration.
  { source: null, name: 'InfoFiMarket', static: true },
  { source: 'InfoFiMarketFactory.sol/InfoFiMarketFactory.json', name: 'InfoFiMarketFactory' },
  { source: 'InfoFiPriceOracle.sol/InfoFiPriceOracle.json', name: 'InfoFiPriceOracle' },
  { source: 'InfoFiSettlement.sol/InfoFiSettlement.json', name: 'InfoFiSettlement' },
  { source: 'MarketTypeRegistry.sol/MarketTypeRegistry.json', name: 'MarketTypeRegistry' },

  // InfoFi FPMM (V2)
  { source: 'RaffleOracleAdapter.sol/RaffleOracleAdapter.json', name: 'RaffleOracleAdapter' },
  { source: 'InfoFiFPMMV2.sol/InfoFiFPMMV2.json', name: 'InfoFiFPMMV2' },
  { source: 'InfoFiFPMMV2.sol/SimpleFPMM.json', name: 'SimpleFPMM' },
  { source: 'InfoFiFPMMV2.sol/SOLPToken.json', name: 'SOLPToken' },
  { source: 'ConditionalTokenSOF.sol/ConditionalTokenSOF.json', name: 'ConditionalTokenSOF' },

  // Bonding Curve & Tokens
  { source: 'SOFBondingCurve.sol/SOFBondingCurve.json', name: 'SOFBondingCurve' },
  { source: 'SOFToken.sol/SOFToken.json', name: 'SOFToken' },
  { source: 'SOFFaucet.sol/SOFFaucet.json', name: 'SOFFaucet' },

  // Season Management
  { source: 'SeasonFactory.sol/SeasonFactory.json', name: 'SeasonFactory' },
  { source: 'SeasonGating.sol/SeasonGating.json', name: 'SeasonGating' },

  // Standard Interfaces
  { source: 'ERC20.sol/ERC20.json', name: 'ERC20' },
  { source: 'AccessControl.sol/AccessControl.json', name: 'AccessControl' },

  // Sponsor Staking
  { source: 'Hats.sol/Hats.json', name: 'Hats' },
  { source: 'StakingEligibility.sol/StakingEligibility.json', name: 'StakingEligibility' },

  // Exchange & Airdrop
  { source: 'SOFExchange.sol/SOFExchange.json', name: 'SOFExchange' },
  { source: 'SOFAirdrop.sol/SOFAirdrop.json', name: 'SOFAirdrop' },

  // Smart Account (ERC-7702)
  { source: 'SOFSmartAccount.sol/SOFSmartAccount.json', name: 'SOFSmartAccount' },
];

async function exportAbis() {
  await fs.mkdir(abiDir, { recursive: true });

  const exported = [];
  const failed = [];

  for (const contract of CONTRACTS_TO_EXPORT) {
    const destPath = path.join(abiDir, `${contract.name}.json`);

    // Static ABIs are manually maintained — skip Foundry extraction, just verify they exist
    if (contract.static) {
      try {
        await fs.access(destPath);
        console.log(`  ${contract.name}.json (static — manually maintained)`);
        exported.push(contract.name);
      } catch {
        console.error(`  ${contract.name}.json MISSING — static ABI not found at ${destPath}`);
        failed.push(contract.name);
      }
      continue;
    }

    const sourcePath = path.join(contractsDir, contract.source);

    try {
      const fileContent = await fs.readFile(sourcePath, 'utf8');
      const contractJson = JSON.parse(fileContent);

      if (!contractJson.abi) {
        console.error(`[export-abis] No ABI found in ${contract.source}`);
        failed.push(contract.name);
        continue;
      }

      await fs.writeFile(destPath, JSON.stringify(contractJson.abi, null, 2) + '\n');
      exported.push(contract.name);
      console.log(`  ${contract.name}.json`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.access(destPath);
          console.log(`  ${contract.name}.json (kept existing — source not in build)`);
          exported.push(contract.name);
        } catch {
          console.warn(`  ${contract.name}.json SKIPPED (source not found: ${contract.source})`);
          failed.push(contract.name);
        }
      } else {
        console.error(`[export-abis] Error processing ${contract.name}:`, error.message);
        failed.push(contract.name);
      }
    }
  }

  // Generate index.js with named exports
  const indexLines = [
    '// Auto-generated by scripts/export-abis.js — do not edit manually',
    '// Run `npm run build --workspace=@sof/contracts` to regenerate',
    '',
  ];

  for (const name of exported) {
    indexLines.push(`import _${name} from './${name}.json' with { type: 'json' };`);
  }

  indexLines.push('');
  indexLines.push('// Helper: extract abi array from Foundry JSON or return as-is');
  indexLines.push('const e = (json) => json.abi || json;');
  indexLines.push('');

  for (const name of exported) {
    indexLines.push(`export const ${name}ABI = e(_${name});`);
  }

  indexLines.push('');

  const indexPath = path.join(abiDir, 'index.js');
  await fs.writeFile(indexPath, indexLines.join('\n'));

  console.log(`\n[export-abis] Exported ${exported.length} ABIs, ${failed.length} failed`);
  if (failed.length) {
    console.warn(`[export-abis] Failed: ${failed.join(', ')}`);
  }
}

exportAbis().catch((err) => {
  console.error('[export-abis] Fatal error:', err);
  process.exit(1);
});
