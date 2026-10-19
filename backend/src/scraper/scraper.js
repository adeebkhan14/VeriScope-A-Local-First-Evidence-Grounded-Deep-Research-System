import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

/**
 * Scrapes a single webpage with fallback handling:
 * 1. Fast Axios + Cheerio extraction.
 * 2. Optional Playwright headless browser fallback for JS-rendered pages.
 * 3. Search snippet fallback if page is completely inaccessible.
 *
 * @param {{title: string, url: string, content?: string}} result
 * @param {{allowBrowserFallback?: boolean}} [options]
 * @returns {Promise<{title: string, url: string, content: string, method: string, isSnippetFallback?: boolean, error?: string}>}
 */
export async function scrapePage(
  result,
  { allowBrowserFallback = false } = {}
) {
  // First attempt: Axios + Cheerio
  const staticResult = await scrapeWithAxios(result);

  if (staticResult.content && staticResult.content.length >= 250) {
    return staticResult;
  }

  // Second attempt: Playwright if explicitly allowed
  if (allowBrowserFallback) {
    console.log(`↻ Using Playwright fallback: ${result.url}`);
    const browserResult = await scrapeWithPlaywright(result);
    if (browserResult.content && browserResult.content.length >= 250) {
      return browserResult;
    }
  }

  // Third attempt: Fall back to search snippet from SearXNG
  const searchSnippet = cleanTextContent(result.content || "");
  if (searchSnippet.length >= 40) {
    return {
      title: result.title,
      url: result.url,
      content: searchSnippet,
      method: "snippet-fallback",
      isSnippetFallback: true,
      error: staticResult.error || "Webpage content was minimal or blocked; used search snippet.",
    };
  }

  return {
    title: result.title,
    url: result.url,
    content: staticResult.content || "",
    method: staticResult.method,
    error: staticResult.error || "Webpage content was empty or unreadable.",
  };
}

// ------------------------------------
// Axios + Cheerio
// ------------------------------------

async function scrapeWithAxios(result) {
  if (!result?.url || typeof result.url !== "string") {
    return {
      title: result?.title || "Untitled",
      url: "",
      content: "",
      error: "Invalid or missing URL",
      method: "axios",
    };
  }

  try {
    const response = await axios.get(result.url, {
      timeout: 8000,
      maxContentLength: 5 * 1024 * 1024, // 5MB max
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = response.headers["content-type"] || "";
    if (
      contentType &&
      !contentType.includes("text") &&
      !contentType.includes("html") &&
      !contentType.includes("xml") &&
      !contentType.includes("json")
    ) {
      return {
        title: result.title,
        url: result.url,
        content: "",
        error: `Skipped non-text content type (${contentType})`,
        method: "axios",
      };
    }

    const html = typeof response.data === "string" ? response.data : String(response.data || "");
    const $ = cheerio.load(html);

    // Remove irrelevant elements
    $(
      "script, style, nav, footer, header, noscript, svg, form, iframe, aside, dialog, .ads, .cookie-banner"
    ).remove();

    const text = $("body").text();
    const cleanText = cleanTextContent(text);

    return {
      title: $("title").text().trim() || result.title,
      url: result.url,
      content: cleanText,
      method: "axios",
    };
  } catch (error) {
    const isTimeout = error.code === "ETIMEDOUT" || error.message?.includes("timeout");
    const reason = isTimeout ? "Request timed out" : error.message;

    return {
      title: result.title,
      url: result.url,
      content: "",
      error: `Scraping failed (${reason})`,
      method: "axios",
    };
  }
}

// ------------------------------------
// Playwright fallback
// ------------------------------------

async function scrapeWithPlaywright(result) {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    await page.goto(result.url, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const elements = document.querySelectorAll(
        "script, style, nav, footer, header, noscript, svg, form, iframe, aside, dialog, .ads, .cookie-banner"
      );
      elements.forEach((element) => element.remove());
    });

    const title = await page.title();
    const text = await page.locator("body").innerText();
    const cleanText = cleanTextContent(text);

    return {
      title: title || result.title,
      url: result.url,
      content: cleanText,
      method: "playwright",
    };
  } catch (error) {
    return {
      title: result.title,
      url: result.url,
      content: "",
      error: `Playwright fallback failed: ${error.message}`,
      method: "playwright",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ------------------------------------
// Clean text
// ------------------------------------

function cleanTextContent(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}