const puppeteer = require('puppeteer');

async function scrapeFabrilifeProducts() {
    const browser = await puppeteer.launch({
        headless: false, // Set to true for production, false helps debugging
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set a realistic viewport and user agent to avoid detection
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log('Navigating to Fabrilife search page...');
        await page.goto('https://fabrilife.com/shop?query=t-shirt', {
            waitUntil: 'networkidle2', // Wait for network to be idle
            timeout: 60000
        });

        // Wait for product containers to load
        // Note: You'll need to inspect the actual page to find the correct selectors
        // Common patterns: '.product-item', '.product-card', '[data-product-id]'
        console.log('Waiting for products to load...');
        
        await page.waitForSelector('.product-item, .product-card, [class*="product"]', {
            timeout: 15000,
            visible: true
        });

        // Optional: Auto-scroll to load lazy-loaded products
        await autoScroll(page);

        // Extract product information
        const products = await page.evaluate(() => {
            // Try multiple possible product container selectors
            const productSelectors = [
                '.product-item',
                '.product-card', 
                '[class*="product-item"]',
                '[class*="product-card"]',
                '.shop-product',
                '.product'
            ];
            
            let productElements = [];
            for (const selector of productSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    productElements = Array.from(elements);
                    break;
                }
            }
            
            // Extract data from product elements
            return productElements.map(product => {
                // Try multiple selector patterns for each field
                const findText = (selectors) => {
                    for (const selector of selectors) {
                        const element = product.querySelector(selector);
                        const text = element?.textContent?.trim();
                        if (text) return text;
                    }
                    return null;
                };
                
                const findImage = (selectors) => {
                    for (const selector of selectors) {
                        const element = product.querySelector(selector);
                        if (element?.src) return element.src;
                        if (element?.getAttribute('data-src')) return element.getAttribute('data-src');
                    }
                    return null;
                };
                
                const findLink = (selectors) => {
                    for (const selector of selectors) {
                        const element = product.querySelector(selector);
                        if (element?.href) return element.href;
                    }
                    return null;
                };
                
                return {
                    name: findText([
                        '.product-title',
                        '.product-name',
                        '[class*="title"]',
                        '[class*="name"]',
                        'h3', 'h4'
                    ]),
                    price: findText([
                        '.price',
                        '.product-price',
                        '[class*="price"]',
                        '.current-price',
                        '.sale-price'
                    ]),
                    originalPrice: findText([
                        '.original-price',
                        '.regular-price',
                        '[class*="original"]'
                    ]),
                    imageUrl: findImage([
                        'img',
                        '.product-image img',
                        '[class*="image"] img'
                    ]),
                    productUrl: findLink([
                        'a',
                        '.product-link',
                        '[class*="link"]'
                    ]),
                };
            }).filter(product => product.name); // Remove empty entries
        });

        console.log(`Found ${products.length} products\n`);
        
        // Display results
        products.forEach((product, index) => {
            console.log(`Product ${index + 1}:`);
            console.log(`  Name: ${product.name || 'N/A'}`);
            console.log(`  Price: ${product.price || 'N/A'}`);
            console.log(`  Original Price: ${product.originalPrice || 'N/A'}`);
            console.log(`  Image URL: ${product.imageUrl || 'N/A'}`);
            console.log(`  Product URL: ${product.productUrl || 'N/A'}`);
            console.log('---');
        });

        // Save to JSON file
        const fs = require('fs');
        fs.writeFileSync('fabrilife-products.json', JSON.stringify(products, null, 2));
        console.log('\nData saved to fabrilife-products.json');

        return products;

    } catch (error) {
        console.error('Scraping error:', error);
        
        // Take screenshot for debugging
        await page.screenshot({ path: 'error-screenshot.png' });
        console.log('Screenshot saved to error-screenshot.png');
        
    } finally {
        await browser.close();
    }
}

// Helper function to auto-scroll the page
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

// Alternative approach using page.$$eval for more control
async function scrapeWithExactSelectors() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://fabrilife.com/shop?query=t-shirt', {
        waitUntil: 'networkidle2'
    });
    
    // Wait for any product elements to be present
    await page.waitForSelector('[class*="product"]', { timeout: 10000 });
    
    // Get the exact class names from the live page
    const pageContent = await page.content();
    console.log('Page loaded. Inspecting structure...');
    
    // Find all elements that might contain product data
    const possibleContainers = await page.$$eval(
        'div[class*="product"], div[class*="item"], li[class*="product"]',
        (elements) => {
            return elements.map(el => ({
                className: el.className,
                hasImage: !!el.querySelector('img'),
                hasPrice: !!el.querySelector('[class*="price"]'),
                hasTitle: !!el.querySelector('[class*="title"], h3, h4')
            }));
        }
    );
    
    console.log('Found potential product containers:', possibleContainers);
    
    // If you find the correct selectors, use this pattern:
    const products = await page.$$eval('.actual-product-class-name', (products) => {
        return products.map(product => ({
            name: product.querySelector('.product-title')?.innerText?.trim() || 'N/A',
            price: product.querySelector('.price')?.innerText?.trim() || 'N/A',
            image: product.querySelector('img')?.src || 'N/A',
            link: product.querySelector('a')?.href || 'N/A'
        }));
    });
    
    console.log(products);
    await browser.close();
}

// Run the scraper
scrapeFabrilifeProducts().catch(console.error);