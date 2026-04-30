const puppeteer = require('puppeteer');
const fs = require('fs');

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
                await delay(2000); // Fixed: replaced page.waitForTimeout with delay
            }
        } catch (error) {
            console.log('No delivery area popup or already selected');
        }

        // Wait for products to load
        await page.waitForSelector('[class*="product"], [class*="item"], .card, .grid-item', { 
            timeout: 10000 
        });

        // Scroll to load products but stop when we have 50
        let previousProductCount = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 30;
        let totalProductsFound = 0;
        
        while (totalProductsFound < 50 && scrollAttempts < maxScrollAttempts) {
            // Scroll down
            await page.evaluate(() => {
                window.scrollBy(0, 500);
            });
            
            // Wait for new products to load
            await delay(1000); // Fixed: replaced page.waitForTimeout with delay
            
            // Get current product count
            totalProductsFound = await page.evaluate(() => {
                const productSelectors = [
                    '.product-item',
                    '.product-card', 
                    '.grid-item',
                    '[class*="product"]',
                    '[class*="item"]',
                    '.card'
                ];
                
                for (const selector of productSelectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        return elements.length;
                    }
                }
                return 0;
            });
            
            console.log(`Found ${totalProductsFound} products so far...`);
            
            // If no new products loaded, increment counter
            if (totalProductsFound === previousProductCount) {
                scrollAttempts++;
            } else {
                scrollAttempts = 0;
                previousProductCount = totalProductsFound;
            }
            
            // Stop if we reach or exceed 50
            if (totalProductsFound >= 50) {
                console.log(`Reached ${totalProductsFound} products, stopping scroll`);
                break;
            }
        }

        // Extract only first 50 products
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
                    productElements = Array.from(elements);
                    console.log(`Found ${productElements.length} total products using selector: ${selector}`);
                    break;
                }
            }
            
            // Process only first 50 products
            const productsToProcess = productElements.slice(0, 50);
            
            productsToProcess.forEach((element, index) => {
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

        // Display results (only first 50)
        console.log(`\n✅ Found ${products.length} products (first 50) for "${searchTerm}":\n`);
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
    console.log('Starting scraper for "Potato" - Target: First 50 products only\n');
    
    // Try API method first (more reliable if available)
    const apiData = await scrapeViaAPI('Potato');
    if (apiData) {
        console.log('Successfully retrieved data via API!');
        // Save API results
        fs.writeFileSync('products_api.json', JSON.stringify(apiData, null, 2));
        console.log(`\n💾 API Results saved to products_api.json`);
    } else {
        // Fall back to DOM scraping
        const products = await scrapeProducts('Potato');
        
        // Save results to JSON file
        fs.writeFileSync('products_first_50.json', JSON.stringify(products, null, 2));
        console.log(`\n💾 Results saved to products_first_50.json`);
        
        // Also save as CSV for Excel
        if (products.length > 0) {
            const csvHeaders = ['ID', 'Name', 'Price', 'Product URL', 'Image URL'];
            const csvRows = products.map(p => [
                p.id,
                `"${p.name.replace(/"/g, '""')}"`,
                p.price || '',
                p.productUrl || '',
                p.imageUrl || ''
            ]);
            
            const csvContent = [csvHeaders, ...csvRows].map(row => row.join(',')).join('\n');
            fs.writeFileSync('products_first_50.csv', csvContent);
            console.log('💾 Results also saved to products_first_50.csv');
        }
    }
    
    console.log('\n✨ Scraping completed!');
})();