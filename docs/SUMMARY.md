# Table of Contents

## Getting Started

* [Welcome](README.md)

## Product Documentation

* [Product Overview](01-product/README.md)
  * [Product Framework](01-product/framework.md)
  * [Tokenomics](01-product/tokenomics.md)
  * [Bonding Curve & Prize Pool](01-product/bonding-curve.md)
  * [Liquidity & Rewards](01-product/liquidity-rewards.md)
  * [Winner Selection](01-product/winner-selection.md)

## Architecture

* [Architecture Overview](02-architecture/README.md)
  * [Project Requirements](02-architecture/requirements.md)
  * [Project Structure](02-architecture/structure.md)
  * [Data Schema](02-architecture/data-schema.md)
  * [InfoFi Integration](02-architecture/infofi-integration/README.md)
    * [Part 1: Overview](02-architecture/infofi-integration/part-1-overview.md)
    * [Part 2: Smart Contracts](02-architecture/infofi-integration/part-2-contracts.md)
    * [Part 3: Backend Services](02-architecture/infofi-integration/part-3-backend.md)
    * [Part 4: Frontend Integration](02-architecture/infofi-integration/part-4-frontend.md)
    * [Part 5: Database Schema](02-architecture/infofi-integration/part-5-database.md)
    * [Part 6: Real-time Architecture](02-architecture/infofi-integration/part-6-realtime.md)
    * [Part 7: Arbitrage Detection](02-architecture/infofi-integration/part-7-arbitrage.md)
    * [Part 8: Security Considerations](02-architecture/infofi-integration/part-8-security.md)
    * [Part 9: Deployment](02-architecture/infofi-integration/part-9-deployment.md)

## Development

* [Development Overview](03-development/README.md)
  * [Frontend Guidelines](03-development/frontend-guidelines.md)
  * [Project Tasks](03-development/tasks.md)
  * [Prediction Market Dev Plan](03-development/prediction-market-plan.md)
  * [Quick Reference](03-development/quick-reference.md)

## API Reference

* [API Overview](04-api/README.md)
  * [Analytics API](04-api/analytics.md)
  * [Arbitrage API](04-api/arbitrage.md)
  * [InfoFi API](04-api/infofi.md)
  * [Pricing API](04-api/pricing.md)
  * [Settlement API](04-api/settlement.md)

## Features

* [Features Overview](05-features/README.md)
  * [Internationalization (i18n)](05-features/i18n/README.md)
    * [Integration Plan](05-features/i18n/integration-plan.md)
    * [Localization System](05-features/i18n/localization-system.md)
    * [Sample Translations](05-features/i18n/sample-translations.md)
  * [Arbitrage Detection](05-features/arbitrage/README.md)
    * [Detection System](05-features/arbitrage/detection.md)
    * [Flow Diagram](05-features/arbitrage/flow-diagram.md)
  * [Treasury System](05-features/treasury/README.md)
    * [System Overview](05-features/treasury/system.md)
  * [Consolation System](05-features/consolation/README.md)
    * [Implementation](05-features/consolation/implementation.md)

## Technical Analysis

* [Technical Analysis Overview](06-technical-analysis/README.md)
  * [Fee Collection Gas Analysis](06-technical-analysis/fee-collection-gas.md)

## Changelog

* [Changelog Overview](07-changelog/README.md)
  * [October 2025](07-changelog/2025-10/README.md)
    * [Oct 3: Implementation Summary](07-changelog/2025-10/03-implementation-summary.md)
    * [Oct 3: Session Summary](07-changelog/2025-10/03-session-summary.md)
    * [Oct 3: Evening Session](07-changelog/2025-10/03-session-evening.md)
    * [Oct 3: Progress Summary](07-changelog/2025-10/03-progress-summary.md)
  * [Feature Implementations](07-changelog/features/README.md)
    * [Account Routing Fix](07-changelog/features/account-routing-fix.md)
    * [Arbitrage Implementation](07-changelog/features/arbitrage-implementation.md)
    * [Consolation System](07-changelog/features/consolation-system.md)
    * [i18n Implementation](07-changelog/features/i18n-implementation.md)
    * [Name Validation](07-changelog/features/name-validation.md)
    * [Prize Sponsorship](07-changelog/features/prize-sponsorship.md)
    * [Transactions & Holders](07-changelog/features/transactions-holders.md)
    * [Treasury Implementation](07-changelog/features/treasury-implementation.md)

## Bug Fixes

* [Bug Fixes Overview](08-bug-fixes/README.md)
  * [Display Issues](08-bug-fixes/display-issues/README.md)
    * [Consolation Display](08-bug-fixes/display-issues/consolation-display.md)
    * [Odds Display](08-bug-fixes/display-issues/odds-display.md)
    * [Position Display](08-bug-fixes/display-issues/position-display.md)
    * [Prize Pool Display](08-bug-fixes/display-issues/prize-pool-display.md)
    * [Tabs Display](08-bug-fixes/display-issues/tabs-display.md)
    * [Token Info Display](08-bug-fixes/display-issues/token-info-display.md)
  * [Trading Issues](08-bug-fixes/trading-issues/README.md)
    * [Max Sell Revert](08-bug-fixes/trading-issues/max-sell-revert.md)
    * [Sell All Tokens](08-bug-fixes/trading-issues/sell-all-tokens.md)
    * [Sell Max Fix](08-bug-fixes/trading-issues/sell-max-fix.md)
    * [Trading Lock Guard](08-bug-fixes/trading-issues/trading-lock-guard.md)
  * [Test Fixes](08-bug-fixes/test-fixes/README.md)
    * [E2E Test Results](08-bug-fixes/test-fixes/e2e-test-results.md)
    * [Failing Tests Analysis](08-bug-fixes/test-fixes/failing-tests-analysis.md)
    * [Frontend Timing Fixes](08-bug-fixes/test-fixes/frontend-timing-fixes.md)
    * [Raffle Holders Test](08-bug-fixes/test-fixes/raffle-holders-test.md)
    * [Test Fixes Final](08-bug-fixes/test-fixes/test-fixes-final.md)
    * [Test Fixes Progress](08-bug-fixes/test-fixes/test-fixes-progress.md)
    * [Test Fixes Session](08-bug-fixes/test-fixes/test-fixes-session.md)
    * [Test Suite Complete](08-bug-fixes/test-fixes/test-suite-complete.md)
  * [Other Fixes](08-bug-fixes/other/README.md)
    * [InfoFi Odds Bug](08-bug-fixes/other/infofi-odds-bug.md)
    * [Raffle Details Update](08-bug-fixes/other/raffle-details-update.md)
    * [Raffle Tabs Block Range](08-bug-fixes/other/raffle-tabs-block-range.md)
    * [Raffle Tabs Fix](08-bug-fixes/other/raffle-tabs-fix.md)
    * [Tabs Empty Data](08-bug-fixes/other/tabs-empty-data.md)
    * [Transaction Confirmation](08-bug-fixes/other/transaction-confirmation.md)

## Investigations

* [Investigations Overview](09-investigations/README.md)
  * [Position Display Investigation](09-investigations/position-display-investigation.md)
  * [Treasury Admin Debug](09-investigations/treasury-admin-debug.md)
