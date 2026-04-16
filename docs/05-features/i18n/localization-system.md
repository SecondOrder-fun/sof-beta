# Localization System

## Overview

SecondOrder.fun supports 9 languages with a comprehensive localization system powered by react-i18next.

## Supported Languages

| Language | Code | Native Name | Status |
|----------|------|-------------|--------|
| English | `en` | English | Complete (1,080 keys) |
| Japanese | `ja` | 日本語 | Near-complete (1,012 keys) |
| French | `fr` | Français | Complete (1,015 keys) |
| Spanish | `es` | Español | Complete (1,016 keys) |
| German | `de` | Deutsch | Complete (1,016 keys) |
| Portuguese | `pt` | Português | Complete (1,012 keys) |
| Italian | `it` | Italiano | Complete (1,015 keys) |
| Chinese | `zh` | 中文 | Complete (1,012 keys) |
| Russian | `ru` | Русский | Complete (1,012 keys) |

## Translation Files

All translation files are located in `packages/frontend/public/locales/{language-code}/`

Each language has 11 namespace files:

| Namespace | Description |
|-----------|-------------|
| `common.json` | Common UI elements |
| `navigation.json` | Navigation and branding |
| `raffle.json` | Raffle-specific terms |
| `market.json` | Prediction market terms |
| `admin.json` | Admin panel terms |
| `account.json` | Account management |
| `errors.json` | Error messages |
| `transactions.json` | Transaction states |
| `airdrop.json` | Airdrop claim flow |
| `auth.json` | Authentication UI |
| `swap.json` | Token swap interface |

## Creating New Language Stubs

Use the provided script to create stub files for a new language:

```bash
cd packages/frontend
node scripts/create-locale-stub.js <locale-code>
```

The script will:
1. Create a new directory in `public/locales/{locale-code}/`
2. Copy all JSON files from English with the same structure
3. Keep English values as placeholders for translation

After creating stubs:
1. Translate the values in the JSON files
2. Update `src/i18n/config.js` to add the language code to `supportedLngs`
3. Update `src/i18n/languages.js` to add language metadata
4. Update `src/main.jsx` RainbowKit locale mapping if supported
5. Test the translations in the application

## Using Translations in Components

```javascript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation('namespace');
  return <div>{t('key')}</div>;
};
```

### With Variables

```javascript
{t('showingRange', { start: 1, end: 10, total: 100 })}
// Output: "Showing 1-10 of 100" (English)
// Output: "1-10 / 100件を表示中" (Japanese)
```

### Multiple Namespaces

```javascript
const { t } = useTranslation(['common', 'raffle']);

{t('common:loading')}
{t('raffle:buyTickets')}
```

## Language Detection

The system automatically detects the user's preferred language using:
1. **localStorage** — Previously selected language (persisted)
2. **Browser navigator** — Browser language settings

Users can manually switch languages using the language toggle in the header.

## RainbowKit Wallet Integration

The Connect Wallet button automatically adapts to the selected language.

**Supported by RainbowKit:** en, ja, fr, es, pt, zh, ru

**Fallback to English:** de, it (not supported by RainbowKit)

The mapping is handled automatically in `src/main.jsx` via the `RainbowKitWrapper` component.

## File Structure

```
packages/frontend/
├── public/locales/
│   ├── en/           # English (source of truth)
│   ├── ja/           # Japanese
│   ├── fr/           # French
│   ├── es/           # Spanish
│   ├── de/           # German
│   ├── pt/           # Portuguese
│   ├── it/           # Italian
│   ├── zh/           # Chinese
│   └── ru/           # Russian
├── src/i18n/
│   ├── config.js     # i18next configuration
│   ├── index.js      # i18n initialization
│   └── languages.js  # Language metadata
└── scripts/
    └── create-locale-stub.js
```

## Best Practices

### For Translators

1. Keep formatting intact — preserve `{{variables}}` and special characters
2. Maintain tone — match the casual, friendly tone of the platform
3. Test in context — view translations in the actual UI
4. Consider length — some languages are more verbose than others

### For Developers

1. Use semantic keys — `buyTickets` not `button1`
2. Group related keys — use namespaces effectively
3. Never hardcode strings — always use translation keys
4. Test all languages — switch languages during development
