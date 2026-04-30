const puppeteer = require('puppeteer');

async function scrapeProducts(searchTerm) {
    let browser;
    
    try {
        // Launch browser
        browser = await puppeteer.launch({
            headless: false, // Set to true for production, false helps debugging
            defaultViewport: null,
            args: ['--start-maximized']
        });

        const page = await browser.newPage();
        
        // Navigate to search page
        const url = `https://www.shwapno.com/search?q=${searchTerm}`;
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Handle delivery area popup if present
        try {
            // Wait for area selection modal/dropdown
            await page.waitForSelector('select, .area-select, [class*="area"], [class*="delivery"]', { timeout: 5000 });
            
            // Try to select first available area option
            const areaSelected = await page.evaluate(() => {
                const select = document.querySelector('select, .area-select');
                if (select && select.options && select.options.length > 1) {
                    select.value = select.options[1].value;
                    select.dispatchEvent(new Event('change'));
                    return true;
                }
                
                // Try clicking confirm button
                const confirmBtn = document.querySelector('button:contains("Confirm"), button:contains("OK")');
                if (confirmBtn) {
                    confirmBtn.click();
                    return true;
                }
                return false;
            });
            
            if (areaSelected) {
                console.log('Delivery area selected');
                await page.waitForTimeout(2000); // Wait for content to reload
            }
        } catch (error) {
            console.log('No delivery area popup or already selected');
        }

        // Wait for products to load
        await page.waitForSelector('[class*="product"], [class*="item"], .card, .grid-item', { 
            timeout: 10000 
        });

        // Scroll to load all products (lazy loading)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
            });
        });

        // Extract product information
        const products = await page.evaluate(() => {
            const productData = [];
            
            // Try multiple possible selectors for product containers
            const productSelectors = [
                '.product-item',
                '.product-card', 
                '.grid-item',
                '[class*="product"]',
                '[class*="item"]',
                '.card'
            ];
            
            let productElements = [];
            for (const selector of productSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    productElements = elements;
                    console.log(`Found ${elements.length} products using selector: ${selector}`);
                    break;
                }
            }
            
            productElements.forEach((element, index) => {
                // Try to find product name with various selectors
                const nameSelectors = [
                    '.product-title',
                    '.product-name',
                    'h2', 'h3', 'h4',
                    '[class*="title"]',
                    '[class*="name"]'
                ];
                
                let name = '';
                for (const selector of nameSelectors) {
                    const nameElement = element.querySelector(selector);
                    if (nameElement && nameElement.innerText.trim()) {
                        name = nameElement.innerText.trim();
                        break;
                    }
                }
                
                // Try to find price
                const priceSelectors = [
                    '.price',
                    '.product-price',
                    '[class*="price"]',
                    '.current-price'
                ];
                
                let price = '';
                for (const selector of priceSelectors) {
                    const priceElement = element.querySelector(selector);
                    if (priceElement && priceElement.innerText.trim()) {
                        price = priceElement.innerText.trim();
                        break;
                    }
                }
                
                // Try to find image
                let imageUrl = '';
                const imgElement = element.querySelector('img');
                if (imgElement) {
                    imageUrl = imgElement.src || imgElement.getAttribute('data-src');
                }
                
                // Try to find product link
                let productUrl = '';
                const linkElement = element.querySelector('a');
                if (linkElement) {
                    productUrl = linkElement.href;
                }
                
                // Skip if no name found (likely not a product)
                if (name) {
                    productData.push({
                        id: index + 1,
                        name: name,
                        price: price,
                        imageUrl: imageUrl,
                        productUrl: productUrl,
                        searchTerm: 'potato'
                    });
                }
            });
            
            return productData;
        });

        // Take screenshot for debugging
        await page.screenshot({ path: 'products-page.png', fullPage: true });
        console.log('Screenshot saved as products-page.png');

        // Display results
        console.log(`\n✅ Found ${products.length} products for "${searchTerm}":\n`);
        products.forEach((product, idx) => {
            console.log(`${idx + 1}. ${product.name}`);
            console.log(`   Price: ${product.price || 'N/A'}`);
            console.log(`   URL: ${product.productUrl || 'N/A'}`);
            console.log(`   Image: ${product.imageUrl ? product.imageUrl.substring(0, 80) + '...' : 'N/A'}`);
            console.log('---');
        });

        return products;

    } catch (error) {
        console.error('Scraping error:', error);
        
        // Take error screenshot
        if (browser) {
            const page = await browser.newPage();
            await page.screenshot({ path: 'error-screenshot.png' });
            console.log('Error screenshot saved as error-screenshot.png');
        }
        
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Alternative: Try to find API endpoint (more efficient)
async function scrapeViaAPI(searchTerm) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        // Monitor network requests to find API endpoint
        const apiResponses = [];
        
        page.on('response', response => {
            const url = response.url();
            if (url.includes('/api/') || url.includes('/search') || url.includes('/product')) {
                apiResponses.push(response);
            }
        });
        
        await page.goto(`https://www.shwapno.com/search?q=${searchTerm}`, { 
            waitUntil: 'networkidle2' 
        });
        
        // Try to extract data from API responses
        for (const response of apiResponses) {
            try {
                const data = await response.json();
                if (data && (data.products || data.data)) {
                    console.log('Found API endpoint:', response.url());
                    console.log('API Data:', JSON.stringify(data, null, 2));
                    return data;
                }
            } catch (e) {
                // Not JSON response
            }
        }
        
        console.log('No API endpoint found, falling back to DOM scraping');
        return null;
        
    } finally {
        if (browser) await browser.close();
    }
}

// Run the scraper
(async () => {
    console.log('Starting scraper "...\n');
    
    // Try API method first (more reliable if available)
    const apiData = await scrapeViaAPI('Potato');
    if (apiData) {
        console.log('Successfully retrieved data via API!');
    } else {
        // Fall back to DOM scraping
        const products = await scrapeProducts('Potato');
        
        // Save results to JSON file
        const fs = require('fs');
        fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
        console.log(`\n💾 Results saved to products.json`);
    }
    
    console.log('\n✨ Scraping completed!');
})();