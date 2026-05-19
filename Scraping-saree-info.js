const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE_URL = 'https://www.lerevecraze.com/product-category/search/?s=saree';

async function scrapePage(page) {
    return await page.evaluate(() => {
        const products = [];

        // Le Reve uses WooCommerce structure - adjust selectors if needed
        const productCards = document.querySelectorAll('.product,.product-item,.type-product');

        productCards.forEach(card => {
            const nameEl = card.querySelector('.woocommerce-loop-product__title,.product-title, h2');
            const priceEl = card.querySelector('.price,.woocommerce-Price-amount');
            const linkEl = card.querySelector('a.woocommerce-LoopProduct-link, a');

            const name = nameEl?.innerText?.trim() || null;
            const priceText = priceEl?.innerText?.trim() || null;
            const url = linkEl?.href || null;

            // Try to get image
            const imgEl = card.querySelector('img');
            const image = imgEl?.src || imgEl?.getAttribute('data-src') || null;

            if (name && priceText) {
                products.push({
                    name,
                    price: priceText,
                    url,
                    image,
                    scraped_at: new Date().toISOString()
                });
            }
        });

        return products;
    });
}

async function getProductDetails(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    return await page.evaluate(() => {
        const getText = (selector) => document.querySelector(selector)?.innerText?.trim() || null;

        const sku = getText('.sku');
        const description = getText('.woocommerce-product-details__short-description,.product-short-description');

        // Le Reve specific: they show Color, Size, Fabric in a list
        const details = {};
        document.querySelectorAll('.woocommerce-product-attributes-item,.product-details li').forEach(item => {
            const label = item.querySelector('.woocommerce-product-attributes-item__label, strong')?.innerText?.replace(':', '').trim();
            const value = item.querySelector('.woocommerce-product-attributes-item__value, span')?.innerText?.trim();
            if (label && value) details[label.toLowerCase()] = value;
        });

        return {
            sku,
            description,
           ...details
        };
    });
}

async function main() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    let allProducts = [];
    let currentPage = 1;
    let hasNextPage = true;

    console.log('Starting scrape...');

    while (hasNextPage) {
        const url = currentPage === 1? BASE_URL : `${BASE_URL}&paged=${currentPage}`;
        console.log(`Scraping page ${currentPage}: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for products to load
        await page.waitForSelector('.product,.product-item', { timeout: 10000 }).catch(() => {});

        const products = await scrapePage(page);
        console.log(`Found ${products.length} products on page ${currentPage}`);

        if (products.length === 0) break;

        // Get detailed info for each product
        for (const product of products) {
            if (product.url) {
                try {
                    console.log(` Getting details: ${product.name}`);
                    const details = await getProductDetails(page, product.url);
                    allProducts.push({...product,...details });
                    await page.waitForTimeout(1000); // Be nice to their server
                } catch (err) {
                    console.log(` Failed to get details for ${product.name}: ${err.message}`);
                    allProducts.push(product);
                }
            }
        }

        // Check if next page exists
        hasNextPage = await page.$('.next,.page-numbers.next, a[aria-label="Next"]')!== null;
        currentPage++;

        if (currentPage > 20) break; // Safety limit
    }

    await browser.close();

    // Save to JSON + CSV
    fs.writeFileSync('sarees.json', JSON.stringify(allProducts, null, 2));

    // Simple CSV export
    const headers = ['name', 'price', 'sku', 'color', 'fabric', 'size', 'url'];
    const csv = [
        headers.join(','),
       ...allProducts.map(p =>
            headers.map(h => `"${(p[h] || '').toString().replace(/"/g, '""')}"`).join(',')
        )
    ].join('\n');

    fs.writeFileSync('sarees.csv', csv);

    console.log(`\nDone! Scraped ${allProducts.length} products`);
    console.log('Saved to sarees.json and sarees.csv');
}

main().catch(console.error);