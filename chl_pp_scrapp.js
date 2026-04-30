// puppeteer-scraper.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const ObjectsToCsv = require('objects-to-csv');

puppeteer.use(StealthPlugin());

const SEARCH_TERM = 'milk';

async function scrapeWithPuppeteer(searchTerm) {
    const url = `https://chaldal.com/search?q=${encodeURIComponent(searchTerm)}`;
    console.log(`Launching browser to scrape: ${url}`);

    // Launch a headless browser
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Wait for the product grid to be present on the page
        // You may need to adjust this selector based on the current page structure
        await page.waitForSelector('.product', { timeout: 10000 });

        // Extract product data from the page using page.evaluate()
        const products = await page.evaluate(() => {
            const items = [];
            // This selector might change. Use your browser's inspect tool to find the right one.
            const productElements = document.querySelectorAll('.product');

            productElements.forEach((element) => {
                const name = element.querySelector('.name')?.innerText?.trim();
                const priceElement = element.querySelector('.price');
                const originalPriceElement = element.querySelector('.originalPrice');
                const quantity = element.querySelector('.subText')?.innerText?.trim();

                if (name) {
                    items.push({
                        name: name,
                        price: priceElement ? priceElement.innerText.trim() : 'N/A',
                        originalPrice: originalPriceElement ? originalPriceElement.innerText.trim() : 'N/A',
                        quantity: quantity || 'N/A',
                    });
                }
            });
            return items;
        });

        console.log(`Found ${products.length} products.`);

        if (products.length > 0) {
            const csv = new ObjectsToCsv(products);
            const filename = `chaldal-puppeteer-${searchTerm}-${Date.now()}.csv`;
            await csv.toDisk(`./${filename}`);
            console.log(`Data saved to ${filename}`);
        } else {
            console.log('No products were extracted. The page structure may have changed.');
        }

    } catch (error) {
        console.error('An error occurred:', error.message);
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

scrapeWithPuppeteer(SEARCH_TERM);