// tests/e2e/wallet-connection.test.js
import { test, expect } from '@playwright/test';

test.describe('Wallet Connection Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to your app
    await page.goto('/');
  });

  test('should connect wallet', async ({ page }) => {
    // Click connect wallet button (adjust selector as needed)
    await page.click('[data-testid="connect-wallet"]');
    
    // Wait for MetaMask popup (if using extension)
    // Note: This requires MetaMask extension to be installed
    
    // Alternatively, test with injected provider
    const isMetaMaskAvailable = await page.evaluate(() => {
      return typeof window.ethereum !== 'undefined' && 
             window.ethereum.isMetaMask === true;
    });
    
    expect(isMetaMaskAvailable).toBe(true);
  });

  test('should display SOF balance after connection', async ({ page }) => {
    // This would test your balance display after wallet connection
    // You'll need to implement wallet connection first
    await page.waitForSelector('[data-testid="sof-balance"]');
    const balanceElement = await page.$('[data-testid="sof-balance"]');
    expect(balanceElement).not.toBeNull();
  });

  test('should allow buying raffle tickets', async ({ page }) => {
    // Test the complete flow from wallet connection to buying tickets
    // This would be your main integration test
    await page.click('[data-testid="buy-tickets-button"]');
    
    // Wait for transaction confirmation
    await page.waitForSelector('[data-testid="transaction-confirmed"]');
    
    // Verify tickets were purchased
    const ticketCount = await page.$eval('[data-testid="ticket-count"]', 
      el => parseInt(el.textContent));
    expect(ticketCount).toBeGreaterThan(0);
  });
});
