import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

export async function scrapePage(result, { allowBrowserFallback = true } = {}) {
  // First try Axios + Cheerio
  const staticResult = await scrapeWithAxios(result);

  // If enough useful text was extracted, use it
  if (staticResult.content.length >= 300 || !allowBrowserFallback) {
    console.log(`✓ Axios succeeded: ${result.url}`);

    return staticResult;
  }

  // Otherwise use Playwright
  console.log(`↻ Using Playwright fallback: ${result.url}`);

  return await scrapeWithPlaywright(result);
}


// ------------------------------------
// Axios + Cheerio
// ------------------------------------

async function scrapeWithAxios(result) {
  try {
    const response = await axios.get(result.url, {
      timeout: 10000,

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/154.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(response.data);

    // Remove unnecessary elements
    $("script").remove();
    $("style").remove();
    $("nav").remove();
    $("footer").remove();
    $("header").remove();
    $("noscript").remove();

    const text = $("body").text();

    const cleanText = cleanTextContent(text);

    return {
      title: result.title,
      url: result.url,
      content: cleanText,
      method: "axios",
    };

  } catch (error) {
    return {
      title: result.title,
      url: result.url,
      content: "",
      error: error.message,
      method: "axios",
    };
  }
}


// ------------------------------------
// Playwright fallback
// ------------------------------------

async function scrapeWithPlaywright(result) {
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();

  try {
    await page.goto(result.url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Give JavaScript a little time to render content
    await page.waitForTimeout(1500);

    // Remove unnecessary elements
    await page.evaluate(() => {
      const elements = document.querySelectorAll(
        "script, style, nav, footer, header, noscript"
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
    console.error(`Playwright failed: ${result.url}`);
    console.error(error.message);

    return {
      title: result.title,
      url: result.url,
      content: "",
      error: error.message,
      method: "playwright",
    };

  } finally {
    await browser.close();
  }
}


// ------------------------------------
// Clean text
// ------------------------------------

function cleanTextContent(text) {
  return text
    .replace(/\s+/g, " ")
    .trim();
}