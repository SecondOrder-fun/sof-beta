#!/usr/bin/env node

/**
 * Script to create stub translation files for a new locale
 * Usage: node scripts/create-locale-stub.js <locale-code>
 * Example: node scripts/create-locale-stub.js fr
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const REFERENCE_LOCALE = 'en';

const args = process.argv.slice(2);
const newLocale = args[0];

if (!newLocale) {
  console.error('❌ Error: Please provide a locale code');
  console.log('Usage: node scripts/create-locale-stub.js <locale-code>');
  console.log('Example: node scripts/create-locale-stub.js fr');
  process.exit(1);
}

// Validate locale code format (2-letter ISO 639-1 code)
if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(newLocale)) {
  console.error(`❌ Error: Invalid locale code "${newLocale}"`);
  console.log('Locale code should be a 2-letter ISO 639-1 code (e.g., fr, es, de)');
  console.log('Or include country code (e.g., en-US, pt-BR, zh-CN)');
  process.exit(1);
}

const referenceDir = path.join(LOCALES_DIR, REFERENCE_LOCALE);
const newLocaleDir = path.join(LOCALES_DIR, newLocale);

// Check if reference locale exists
if (!fs.existsSync(referenceDir)) {
  console.error(`❌ Error: Reference locale "${REFERENCE_LOCALE}" not found at ${referenceDir}`);
  process.exit(1);
}

// Check if new locale already exists
if (fs.existsSync(newLocaleDir)) {
  console.error(`❌ Error: Locale "${newLocale}" already exists at ${newLocaleDir}`);
  console.log('If you want to recreate it, delete the directory first.');
  process.exit(1);
}

// Create new locale directory
fs.mkdirSync(newLocaleDir, { recursive: true });
console.log(`✅ Created directory: ${newLocaleDir}`);

// Get all JSON files from reference locale
const files = fs.readdirSync(referenceDir).filter(f => f.endsWith('.json'));

console.log(`\n📄 Creating stub files for ${files.length} translation files...\n`);

let totalKeys = 0;

files.forEach(file => {
  const refFilePath = path.join(referenceDir, file);
  const newFilePath = path.join(newLocaleDir, file);
  
  // Read reference file
  const refContent = JSON.parse(fs.readFileSync(refFilePath, 'utf8'));
  
  // Create stub with same structure but placeholder values
  const stub = createStub(refContent, newLocale);
  
  // Count keys
  const keyCount = countKeys(stub);
  totalKeys += keyCount;
  
  // Write stub file
  fs.writeFileSync(newFilePath, JSON.stringify(stub, null, 2) + '\n', 'utf8');
  
  console.log(`  ✓ ${file.padEnd(20)} (${keyCount} keys)`);
});

console.log(`\n✅ Successfully created ${files.length} stub files with ${totalKeys} total keys`);
console.log(`\n📝 Next steps:`);
console.log(`   1. Translate the stub values in: ${newLocaleDir}`);
console.log(`   2. Update src/i18n.js to include the new locale`);
console.log(`   3. Update LanguageToggle component to show the new language option`);
console.log(`   4. Test the translations in the application\n`);

/**
 * Recursively create stub with placeholder values
 */
function createStub(obj, locale) {
  if (typeof obj !== 'object' || obj === null) {
    return `[${locale.toUpperCase()}] ${obj}`;
  }
  
  const stub = {};
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      stub[key] = createStub(obj[key], locale);
    } else {
      // Keep the English value but mark it as needing translation
      stub[key] = obj[key];
    }
  }
  return stub;
}

/**
 * Count total number of keys in object
 */
function countKeys(obj) {
  let count = 0;
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      count += countKeys(obj[key]);
    } else {
      count++;
    }
  }
  return count;
}
