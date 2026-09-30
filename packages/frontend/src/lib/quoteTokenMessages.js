// src/lib/quoteTokenMessages.js
//
// Why a quote-token choice blocks creating a season, as raffle-namespace i18n
// keys by useQuoteTokenChoice status. Shared by the picker, which shows it under
// the pasted address, and the forms, which repeat it when submit is attempted.

export const QUOTE_TOKEN_BLOCK_MESSAGE = {
  checking: "quoteToken.checking",
  invalid: "quoteToken.invalidAddress",
  ineligible: "quoteToken.notAllowed",
  error: "quoteToken.checkFailed",
};
