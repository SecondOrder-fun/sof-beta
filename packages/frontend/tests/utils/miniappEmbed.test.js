import { describe, it, expect } from "vitest";
import {
  buildSeasonMiniappJson,
  buildMarketMiniappJson,
  buildEmbedHtml,
  escapeHtml,
  isValidId,
} from "../../src/utils/miniappEmbed.js";

describe("miniappEmbed utilities", () => {
  describe("isValidId", () => {
    it("returns true for valid positive integer strings", () => {
      expect(isValidId("1")).toBe(true);
      expect(isValidId("123")).toBe(true);
      expect(isValidId("999999")).toBe(true);
    });

    it("returns false for invalid inputs", () => {
      expect(isValidId("")).toBe(false);
      expect(isValidId("0")).toBe(false);
      expect(isValidId("-1")).toBe(false);
      expect(isValidId("abc")).toBe(false);
      expect(isValidId("1.5")).toBe(false);
      expect(isValidId(" 1 ")).toBe(false);
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
      expect(isValidId(123)).toBe(false);
    });
  });

  describe("escapeHtml", () => {
    it("escapes HTML special characters", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
      expect(escapeHtml('"test"')).toBe("&quot;test&quot;");
      expect(escapeHtml("'test'")).toBe("&#039;test&#039;");
      expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("returns empty string for non-string inputs", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
      expect(escapeHtml(123)).toBe("");
    });

    it("returns unchanged string when no escaping needed", () => {
      expect(escapeHtml("Hello World")).toBe("Hello World");
    });
  });

  describe("buildSeasonMiniappJson", () => {
    it("builds correct JSON structure for season", () => {
      const result = buildSeasonMiniappJson({
        origin: "https://secondorder.fun",
        seasonId: "42",
      });

      expect(result.version).toBe("1");
      expect(result.imageUrl).toBe("https://secondorder.fun/og/season/42");
      expect(result.button.title).toBe("View Season 42");
      expect(result.button.action.type).toBe("launch_frame");
      expect(result.button.action.url).toBe(
        "https://secondorder.fun/raffles/42"
      );
      expect(result.button.action.splashBackgroundColor).toBe("#1a1a2e");
    });

    it("uses custom season name when provided", () => {
      const result = buildSeasonMiniappJson({
        origin: "https://secondorder.fun",
        seasonId: "1",
        seasonName: "Genesis Season",
      });

      expect(result.button.title).toBe("View Genesis Season");
    });
  });

  describe("buildMarketMiniappJson", () => {
    it("builds correct JSON structure for market", () => {
      const result = buildMarketMiniappJson({
        origin: "https://secondorder.fun",
        marketId: "99",
      });

      expect(result.version).toBe("1");
      expect(result.imageUrl).toBe("https://secondorder.fun/og/market/99");
      expect(result.button.title).toBe("View Market 99");
      expect(result.button.action.type).toBe("launch_frame");
      expect(result.button.action.url).toBe(
        "https://secondorder.fun/markets/99"
      );
    });

    it("uses custom market name when provided", () => {
      const result = buildMarketMiniappJson({
        origin: "https://secondorder.fun",
        marketId: "5",
        marketName: "Who wins Season 1?",
      });

      expect(result.button.title).toBe("View Who wins Season 1?");
    });
  });

  describe("buildEmbedHtml", () => {
    const baseParams = {
      title: "Test Title",
      description: "Test Description",
      miniappJson: { version: "1", imageUrl: "https://example.com/img.png" },
      ogImageUrl: "https://example.com/og.png",
      canonicalUrl: "https://example.com/page",
    };

    it("returns valid HTML document", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("</html>");
    });

    it("includes title and description meta tags", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain("<title>Test Title</title>");
      expect(html).toContain('content="Test Description"');
    });

    it("includes Open Graph meta tags", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:image"');
      expect(html).toContain('property="og:url"');
    });

    it("includes Twitter Card meta tags", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain('name="twitter:card"');
      expect(html).toContain('content="summary_large_image"');
    });

    it("includes Farcaster miniapp meta tags", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain('name="fc:miniapp"');
      expect(html).toContain('name="fc:frame"');
      expect(html).toContain('"version":"1"');
    });

    it("escapes XSS attempts in title", () => {
      const html = buildEmbedHtml({
        ...baseParams,
        title: '<script>alert("xss")</script>',
      });

      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;");
    });

    it("includes redirect script for browsers", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain("window.location.replace");
      expect(html).toContain(baseParams.canonicalUrl);
    });

    it("includes noscript fallback", () => {
      const html = buildEmbedHtml(baseParams);

      expect(html).toContain("<noscript>");
      expect(html).toContain("Open in SecondOrder.fun");
    });
  });
});
