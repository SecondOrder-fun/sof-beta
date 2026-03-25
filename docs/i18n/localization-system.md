# Localization System Documentation

## Overview

SecondOrder.fun now supports 9 languages with a comprehensive localization management system for administrators.

## Supported Languages

| Language | Code | Native Name | Flag |
|----------|------|-------------|------|
| English | `en` | English | 🇺🇸 |
| Japanese | `ja` | 日本語 | 🇯🇵 |
| French | `fr` | Français | 🇫🇷 |
| Spanish | `es` | Español | 🇪🇸 |
| German | `de` | Deutsch | 🇩🇪 |
| Portuguese | `pt` | Português | 🇵🇹 |
| Italian | `it` | Italiano | 🇮🇹 |
| Chinese | `zh` | 中文 | 🇨🇳 |
| Russian | `ru` | Русский | 🇷🇺 |

## Translation Files

All translation files are located in `/public/locales/{language-code}/`

Each language has 8 namespace files:
- `common.json` - Common UI elements (92 keys)
- `navigation.json` - Navigation and branding (26 keys)
- `raffle.json` - Raffle-specific terms (93 keys)
- `market.json` - Prediction market terms (136 keys)
- `admin.json` - Admin panel terms (94 keys)
- `account.json` - Account management (66 keys)
- `errors.json` - Error messages (26 keys)
- `transactions.json` - Transaction states (22 keys)

**Total: 555 translation keys per language**

## Creating New Language Stubs

Use the provided script to create stub files for a new language:

```bash
node scripts/create-locale-stub.js <locale-code>
```

Example:
```bash
node scripts/create-locale-stub.js ko  # Korean
node scripts/create-locale-stub.js ar  # Arabic
```

The script will:
1. Create a new directory in `/public/locales/{locale-code}/`
2. Copy all JSON files from English with the same structure
3. Keep English values as placeholders for translation
4. Report the number of keys created

After creating stubs:
1. Translate the values in the JSON files
2. Update `src/i18n/config.js` to add the language code to `supportedLngs`
3. Update `src/i18n/languages.js` to add language metadata
4. Update `src/main.jsx` RainbowKit locale mapping if supported
5. Test the translations in the application

## Admin Localization Management

### Accessing the Interface

Admin users can access the localization management interface at:
```
/admin/localization
```

Or click the "Localization" link in the header navigation (visible only to admins).

### Features

**Translation Editor:**
- View all translation keys and values for any language/namespace
- Search and filter translations
- Click any value to edit inline
- Track completion percentage

**Import/Export:**
- Export translations as JSON files
- Import translations from JSON files
- Useful for working with professional translators

**Completion Tracking:**
- See how many keys are translated vs. total
- Identify untranslated entries (marked with `[LANG]` prefix)

### Usage Workflow

1. Select a language and namespace from the dropdowns
2. Use the search box to find specific keys
3. Click on any translation value to edit it
4. Click "Save" to apply changes locally
5. Use "Export" to download the modified JSON file
6. Replace the file in `/public/locales/{lang}/{namespace}.json`
7. Refresh the application to see changes

**Note:** The current implementation exports files for manual replacement. In production, this would integrate with a backend API to save directly to the server.

## RainbowKit Wallet Integration

The Connect Wallet button automatically adapts to the selected language:

**Supported by RainbowKit:**
- English (`en`)
- Japanese (`ja`)
- French (`fr`)
- Spanish (`es`)
- Portuguese (`pt`)
- Chinese (`zh`)
- Russian (`ru`)

**Fallback to English:**
- German (`de`) - Not supported by RainbowKit
- Italian (`it`) - Not supported by RainbowKit

The mapping is handled automatically in `src/main.jsx` via the `RainbowKitWrapper` component.

## Language Detection

The system automatically detects the user's preferred language using:
1. **localStorage** - Previously selected language (persisted)
2. **Browser navigator** - Browser language settings

Users can manually switch languages using the language toggle in the header.

## For Developers

### Using Translations in Components

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

### Accessing i18n Instance

```javascript
const { i18n } = useTranslation();

// Current language
console.log(i18n.language); // 'en', 'ja', etc.

// Change language programmatically
i18n.changeLanguage('fr');
```

## File Structure

```
public/locales/
├── en/
│   ├── account.json
│   ├── admin.json
│   ├── common.json
│   ├── errors.json
│   ├── market.json
│   ├── navigation.json
│   ├── raffle.json
│   └── transactions.json
├── ja/
│   └── ... (same structure)
├── fr/
│   └── ... (same structure)
└── ... (other languages)

src/i18n/
├── config.js          # i18next configuration
└── languages.js       # Language metadata

scripts/
└── create-locale-stub.js  # Stub generation script
```

## Best Practices

### For Translators

1. **Keep formatting intact** - Preserve `{{variables}}` and special characters
2. **Maintain tone** - Match the casual, friendly tone of the platform
3. **Test in context** - View translations in the actual UI
4. **Consider length** - Some languages are more verbose than others
5. **Cultural adaptation** - Adapt idioms and expressions appropriately

### For Developers

1. **Use semantic keys** - `buyTickets` not `button1`
2. **Group related keys** - Use namespaces effectively
3. **Avoid hardcoded strings** - Always use translation keys
4. **Provide context** - Add comments in JSON for ambiguous terms
5. **Test all languages** - Switch languages during development

## Translation Status

| Language | Status | Completion |
|----------|--------|------------|
| English | ✅ Complete | 100% (555/555) |
| Japanese | ✅ Complete | 100% (555/555) |
| French | 🟡 Stub | 0% (0/555) |
| Spanish | 🟡 Stub | 0% (0/555) |
| German | 🟡 Stub | 0% (0/555) |
| Portuguese | 🟡 Stub | 0% (0/555) |
| Italian | 🟡 Stub | 0% (0/555) |
| Chinese | 🟡 Stub | 0% (0/555) |
| Russian | 🟡 Stub | 0% (0/555) |

**Next Steps:**
- Translate stub files for French, Spanish, German, Portuguese, Italian, Chinese, and Russian
- Consider professional translation services for accuracy
- Gather community feedback on translations
- Add more languages based on user demand

## Troubleshooting

### Translations not loading

1. Check browser console for 404 errors
2. Verify JSON files exist in `/public/locales/{lang}/`
3. Clear browser cache and localStorage
4. Check for JSON syntax errors

### Keys showing instead of translations

1. Verify the key exists in the JSON file
2. Check the namespace is correct
3. Ensure the language code matches exactly
4. Look for typos in translation keys

### Language not switching

1. Check `supportedLngs` in `src/i18n/config.js`
2. Verify language metadata in `src/i18n/languages.js`
3. Clear localStorage: `localStorage.removeItem('i18nextLng')`
4. Hard refresh the browser (Cmd+Shift+R / Ctrl+Shift+R)

## Future Enhancements

- [ ] Backend API for saving translations
- [ ] Translation memory and suggestions
- [ ] Automated translation via AI (with human review)
- [ ] Version control for translations
- [ ] Collaborative translation interface
- [ ] Translation analytics and usage tracking
- [ ] A/B testing for different translations
- [ ] Community translation contributions
