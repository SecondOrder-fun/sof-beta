#!/usr/bin/env node

/**
 * lint-file-length.js
 * 
 * Enforces maximum file length (default 500 lines).
 * Used as pre-commit hook to prevent bloated files from entering the codebase.
 * 
 * Usage:
 *   node scripts/lint-file-length.js [--max-lines 500] [--staged]
 * 
 * Options:
 *   --max-lines N    Maximum allowed lines per file (default: 500)
 *   --staged         Only check staged files (for pre-commit hook)
 *   --exclude PATH   Exclude pattern (can specify multiple times)
 * 
 * Exit codes:
 *   0 - All files pass
 *   1 - One or more files exceed limit
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Default configuration
const DEFAULT_MAX_LINES = 500;
const DEFAULT_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  'contracts/lib',        // Third-party Foundry dependencies
  'contracts/out',        // Foundry build output
  'contracts/cache',      // Foundry cache
  'instructions',         // Project documentation (not source code)
  '*.json'                // Generated ABI/config files
];

// Parse CLI args
function parseArgs() {
  const args = {
    maxLines: DEFAULT_MAX_LINES,
    staged: false,
    excludes: [...DEFAULT_EXCLUDES]
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg === '--max-lines' && i + 1 < process.argv.length) {
      args.maxLines = parseInt(process.argv[++i], 10);
    } else if (arg === '--staged') {
      args.staged = true;
    } else if (arg === '--exclude' && i + 1 < process.argv.length) {
      args.excludes.push(process.argv[++i]);
    } else if (arg === '--help') {
      console.log(`
Usage: node scripts/lint-file-length.js [options]

Options:
  --max-lines N    Maximum allowed lines per file (default: 500)
  --staged         Only check staged files (for pre-commit hook)
  --exclude PATH   Exclude pattern (can specify multiple times)
  --help           Show this help message

Exit codes:
  0 - All files pass
  1 - One or more files exceed limit
      `);
      process.exit(0);
    }
  }

  return args;
}

// Get staged files via git
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.error('Failed to get staged files:', err.message);
    return [];
  }
}

// Get all source files recursively
function getAllSourceFiles(dir, excludes) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(PROJECT_ROOT, fullPath);

    // Check excludes
    if (excludes.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(relativePath) || regex.test(entry.name);
      }
      return relativePath.includes(pattern) || entry.name === pattern;
    })) {
      continue;
    }

    if (entry.isDirectory()) {
      results = results.concat(getAllSourceFiles(fullPath, excludes));
    } else if (entry.isFile() && /\.(js|jsx|ts|tsx|css|md|json|html)$/.test(entry.name)) {
      results.push(relativePath);
    }
  }

  return results;
}

// Count lines in a file
function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err.message);
    return 0;
  }
}

// Main execution
function main() {
  const args = parseArgs();
  
  console.log(`\n📏 Checking file lengths (max: ${args.maxLines} lines)...\n`);

  // Get files to check
  let filesToCheck;
  if (args.staged) {
    filesToCheck = getStagedFiles();
    console.log(`Checking ${filesToCheck.length} staged files...\n`);
  } else {
    filesToCheck = getAllSourceFiles(PROJECT_ROOT, args.excludes);
    console.log(`Checking ${filesToCheck.length} source files...\n`);
  }

  if (filesToCheck.length === 0) {
    console.log('No files to check.\n');
    process.exit(0);
  }

  // Check each file
  const violations = [];
  
  for (const file of filesToCheck) {
    const fullPath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    
    const lineCount = countLines(fullPath);
    if (lineCount > args.maxLines) {
      violations.push({ file, lineCount });
    }
  }

  // Report results
  if (violations.length === 0) {
    console.log('✅ All files pass line count check!\n');
    process.exit(0);
  } else {
    console.error('❌ The following files exceed the maximum line limit:\n');
    
    violations.sort((a, b) => b.lineCount - a.lineCount);
    
    for (const { file, lineCount } of violations) {
      const overage = lineCount - args.maxLines;
      console.error(`  ${file}: ${lineCount} lines (${overage} over limit)`);
    }
    
    console.error(`\n${violations.length} file(s) violate the ${args.maxLines}-line limit.`);
    console.error('\nPlease split large files into smaller, focused modules.');
    console.error('See DEVELOPMENT_RULES.md for guidance.\n');
    
    process.exit(1);
  }
}

main();
