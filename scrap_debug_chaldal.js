const puppeteer = require('puppeteer');

// Helper function for delay (alternative to waitForTimeout)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeChaldalProducts(searchQuery = 'milk') {
    let browser;
    
    try {
        // Launch browser
        browser = await puppeteer.launch({
            headless: false, // Set to true for production
            defaultViewport: { width: 1280, height: 800 },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Enable request interception to monitor network calls
        await page.setRequestInterception(true);
        
        // Store API responses
        const apiResponses = [];
        
        page.on('request', (request) => {
            // Log API requests
            if (request.url().includes('/api/') || request.url().includes('/v1/')) {
                console.log('API Request:', request.url());
            }
            request.continue();
        });
        
        page.on('response', async (response) => {
            const url = response.url();
            // Capture product-related API responses
            if (url.includes('/api/') || url.includes('/search') || url.includes('/products')) {
                try {
                    const data = await response.json();
                    if (data && (data.products || data.items || data.data)) {
                        apiResponses.push({ url, data });
                        console.log('Captured API response:', url);
                    }
                } catch (e) {
                    // Not JSON or empty response
                }
            }
        });
        
        // Navigate to search page
        const searchUrl = `https://chaldal.com/search/${searchQuery}`;
        console.log(`Navigating to: ${searchUrl}`);
        await page.goto(searchUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        // Wait for products to load - using delay function instead of waitForTimeout
        await delay(3000); // Additional wait for dynamic content
        
        // Alternative: Wait for specific element instead of fixed delay
        try {
            await page.waitForSelector('[class*="product"], [class*="Product"], .card, .item', { 
                timeout: 10000 
            });
            console.log('Product elements found!');
        } catch (e) {
            console.log('No product elements found with standard selectors');
        }
        
        // Method 1: Extract products from rendered DOM
        const productsFromDOM = await page.evaluate(() => {
            const products = [];
            
            // Common selectors to try (adjust based on actual structure)
            const selectors = [
                '[data-testid="product-card"]',
                '.product-card',
                '.product-item',
                '[class*="product"]',
                '.card',
                '.item',
                '[class*="Product"]',
                '.product',
                '.productContainer'
            ];
            
            let productElements = [];
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    productElements = elements;
                    console.log(`Found ${elements.length} products using selector: ${selector}`);
                    break;
                }
            }
            
            // If no products found with specific selectors, try to find elements containing price info
            if (productElements.length === 0) {
                const allElements = document.querySelectorAll('div, li, article');
                productElements = Array.from(allElements).filter(el => {
                    const text = el.innerText || '';
                    return text.includes('TK') && text.includes('TK') && el.children.length > 1;
                });
                console.log(`Found ${productElements.length} potential product containers by price detection`);
            }
            
            // Extract product information
            productElements.forEach((element, index) => {
                // Try different selectors for product details
                const name = 
                    element.querySelector('[class*="name"], [class*="title"], h3, h4, [class*="Name"]')?.innerText?.trim() ||
                    element.querySelector('img')?.alt ||
                    `Product ${index + 1}`;
                
                const price = 
                    element.querySelector('[class*="price"], [class*="Price"], [class*="cost"]')?.innerText?.trim() ||
                    Array.from(element.querySelectorAll('*')).find(el => el.innerText?.includes('TK'))?.innerText?.trim();
                
                const image = 
                    element.querySelector('img')?.src ||
                    element.querySelector('[class*="image"] img')?.src;
                
                const brand = 
                    element.querySelector('[class*="brand"], [class*="Brand"]')?.innerText?.trim();
                
                const weight = 
                    element.querySelector('[class*="weight"], [class*="Weight"]')?.innerText?.trim();
                
                if (name && (price || image)) {
                    products.push({
                        name: name.substring(0, 100), // Limit length
                        price: price || 'N/A',
                        image: image || 'N/A',
                        brand: brand || 'N/A',
                        weight: weight || 'N/A',
                        url: window.location.href
                    });
                }
            });
            
            return products;
        });
        
        // Method 2: Extract from page HTML (debugging)
        const pageHTML = await page.content();
        
        // Method 3: Look for script tags containing product data
        const scriptData = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script');
            const dataScripts = [];
            
            scripts.forEach(script => {
                const content = script.innerHTML;
                if (content.includes('product') || content.includes('Product')) {
                    // Look for JSON-like structures
                    const jsonMatches = content.match(/\{.*\}/g);
                    if (jsonMatches) {
                        jsonMatches.forEach(match => {
                            try {
                                const parsed = JSON.parse(match);
                                if (parsed && typeof parsed === 'object') {
                                    dataScripts.push(parsed);
                                }
                            } catch (e) {
                                // Not valid JSON
                            }
                        });
                    }
                }
            });
            
            return dataScripts;
        });
        
        // Method 4: Check window.__INITIAL_STATE__ or similar
        const windowData = await page.evaluate(() => {
            return {
                __INITIAL_STATE__: window.__INITIAL_STATE__ || null,
                __NEXT_DATA__: window.__NEXT_DATA__ || null,
                __NUXT__: window.__NUXT__ || null,
                __REDUX_STATE__: window.__REDUX_STATE__ || null,
                __DATA__: window.__DATA__ || null
            };
        });
        
        // Display results
        console.log('\n=== RESULTS ===\n');
        
        console.log('1. Products found in DOM:', productsFromDOM.length);
        if (productsFromDOM.length > 0) {
            console.log('\nSample products:');
            productsFromDOM.slice(0, 5).forEach((product, i) => {
                console.log(`\nProduct ${i + 1}:`);
                console.log(`  Name: ${product.name}`);
                console.log(`  Price: ${product.price}`);
                console.log(`  Brand: ${product.brand}`);
                console.log(`  Image: ${product.image.substring(0, 80)}...`);
            });
        } else {
            console.log('No products found in DOM. The page structure might be different.');
        }
        
        console.log('\n2. API Responses captured:', apiResponses.length);
        if (apiResponses.length > 0) {
            console.log('\nAPI endpoints found:');
            apiResponses.forEach((resp, i) => {
                console.log(`  ${i + 1}. ${resp.url}`);
                if (resp.data.products) {
                    console.log(`     Products in response: ${resp.data.products.length}`);
                }
                if (resp.data.data && resp.data.data.products) {
                    console.log(`     Products in response.data: ${resp.data.data.products.length}`);
                }
            });
            
            // Display first API response structure
            if (apiResponses[0] && apiResponses[0].data) {
                console.log('\nSample API response structure:');
                console.log(Object.keys(apiResponses[0].data));
                if (apiResponses[0].data.products) {
                    console.log('First product sample:', JSON.stringify(apiResponses[0].data.products[0], null, 2).substring(0, 300));
                }
            }
        }
        
        console.log('\n3. Script tags with data:', scriptData.length);
        
        console.log('\n4. Window data available:');
        Object.entries(windowData).forEach(([key, value]) => {
            if (value) {
                console.log(`   ✓ ${key} found`);
                console.log(`     Sample: ${JSON.stringify(value).substring(0, 200)}...`);
            } else {
                console.log(`   ✗ ${key} not found`);
            }
        });
        
        // Take screenshot for debugging
        await page.screenshot({ path: `chaldal-${searchQuery}-debug.png`, fullPage: true });
        console.log(`\nScreenshot saved: chaldal-${searchQuery}-debug.png`);
        
        // Save HTML for offline analysis
        const fs = require('fs');
        fs.writeFileSync(`chaldal-${searchQuery}-page.html`, pageHTML);
        console.log(`HTML saved: chaldal-${searchQuery}-page.html`);
        
        if (apiResponses.length > 0) {
            fs.writeFileSync(`chaldal-${searchQuery}-api.json`, JSON.stringify(apiResponses, null, 2));
            console.log(`API data saved: chaldal-${searchQuery}-api.json`);
        }
        
        if (productsFromDOM.length > 0) {
            fs.writeFileSync(`chaldal-${searchQuery}-products.json`, JSON.stringify(productsFromDOM, null, 2));
            console.log(`Products saved: chaldal-${searchQuery}-products.json`);
        }
        
        return {
            productsFromDOM,
            apiResponses,
            scriptData,
            windowData,
            pageHTML
        };
        
    } catch (error) {
        console.error('Error during scraping:', error);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Alternative: Direct API approach (if you can find the endpoint)
async function findAndUseAPI() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Listen to all network responses
    const apiCalls = [];
    
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('chaldal.com') && 
            (url.includes('/api/') || url.includes('/v1/') || url.includes('/search') || url.includes('/graphql'))) {
            try {
                const data = await response.json();
                apiCalls.push({ url, data });
                console.log(`\nFound API: ${url}`);
                console.log(`Data keys: ${Object.keys(data)}`);
                if (data.data || data.products) {
                    console.log('Potential product data detected!');
                }
            } catch (e) {
                // Not JSON
                if (url.includes('.json')) {
                    console.log(`Found JSON endpoint: ${url}`);
                }
            }
        }
    });
    
    await page.goto('https://chaldal.com/search/milk', { waitUntil: 'networkidle2' });
    await delay(5000);
    
    console.log('\n=== ALL API CALLS ===');
    apiCalls.forEach((call, index) => {
        console.log(`\n${index + 1}. URL: ${call.url}`);
        console.log(`   Keys: ${Object.keys(call.data)}`);
        if (call.data.products) {
            console.log(`   Products count: ${call.data.products.length}`);
        }
        if (call.data.data && call.data.data.products) {
            console.log(`   Products count (nested): ${call.data.data.products.length}`);
        }
    });
    
    await browser.close();
    return apiCalls;
}

// Execute the scraper
(async () => {
    console.log('Starting Chaldal scraper...\n');
    
    // First try to find API endpoints
    console.log('Step 1: Finding API endpoints...');
    await findAndUseAPI();
    
    console.log('\nStep 2: Extracting products...');
    const results = await scrapeChaldalProducts('milk');
    
    if (results && results.productsFromDOM.length === 0 && results.apiResponses.length === 0) {
        console.log('\n⚠️ No products found. Possible reasons:');
        console.log('1. The website structure has changed');
        console.log('2. Content is loaded differently (e.g., WebSockets, lazy loading)');
        console.log('3. Anti-bot measures are in place');
        console.log('4. The page requires authentication or cookies');
        console.log('\nSuggestions:');
        console.log('- Check the saved screenshot and HTML file');
        console.log('- Look for data in window.__INITIAL_STATE__ or similar global variables');
        console.log('- Try using page.waitForSelector() with specific selectors from the saved HTML');
        console.log('- The site might be using a CDN or firewall that blocks headless browsers');
    }
})();