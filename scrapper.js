const puppeteer = require('puppeteer');
const fs = require('fs').promises;

class BasketBDScraper {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    /**
     * Initialize browser with stealth-like settings
     */
    async init() {
        this.browser = await puppeteer.launch({
            headless: false, // Set to true for production
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ]
        });
        
        this.page = await this.browser.newPage();
        
        // Set realistic viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set user agent to appear more human
        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        
        // Hide automation
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        
        console.log('✅ Browser initialized');
    }

    /**
     * Navigate to page and wait for content
     */
    async navigateToPage(url, waitForSelector = 'body') {
        try {
            console.log(`📄 Navigating to: ${url}`);
            
            await this.page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            // Wait for specific selector or timeout
            await this.page.waitForSelector(waitForSelector, { timeout: 10000 });
            
            // Additional wait for dynamic content
            await this.delay(2000);
            
            console.log('✅ Page loaded successfully');
            return true;
        } catch (error) {
            console.error(`❌ Failed to load page: ${error.message}`);
            return false;
        }
    }

    /**
     * Scroll to load lazy-loaded content
     */
    async autoScroll() {
        await this.page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight || totalHeight > 5000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
    }

    /**
     * Extract product data from current page
     */
    async extractProducts() {
        return await this.page.evaluate(() => {
            const products = [];
            
            // Common selectors for e-commerce sites - adjust based on actual site structure
            const selectors = [
                '.product-item',
                '.product',
                '.product-card',
                '[class*="product"]',
                '.item',
                '.goods',
                'article'
            ];
            
            let productElements = [];
            
            // Try different selectors
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    productElements = Array.from(elements);
                    break;
                }
            }
            
            // If no specific selector found, try finding products by common patterns
            if (productElements.length === 0) {
                // Look for elements that might contain price
                const allElements = document.querySelectorAll('*');
                const potentialProducts = new Set();
                
                allElements.forEach(el => {
                    const text = el.textContent?.toLowerCase() || '';
                    if (text.includes('tk') || text.includes('৳') || text.includes('price')) {
                        // Find parent container
                        let parent = el.closest('div, li, article');
                        if (parent) potentialProducts.add(parent);
                    }
                });
                
                productElements = Array.from(potentialProducts);
            }
            
            console.log(`Found ${productElements.length} potential product elements`);
            
            // Extract data from each product element
            productElements.forEach((element, index) => {
                try {
                    // Try multiple selectors for each field
                    const titleSelectors = [
                        '.product-title', '.title', 'h2', 'h3', 'h4', 
                        '.name', '[class*="title"]', '[class*="name"]'
                    ];
                    
                    const priceSelectors = [
                        '.price', '.product-price', '.amount', 
                        '[class*="price"]', '.tk', '[class*="amount"]'
                    ];
                    
                    const imageSelectors = [
                        'img', '.product-image img', '[class*="image"] img'
                    ];
                    
                    const linkSelectors = [
                        'a', '.product-link', '[class*="link"]'
                    ];
                    
                    // Extract title
                    let title = '';
                    for (const selector of titleSelectors) {
                        const titleEl = element.querySelector(selector);
                        if (titleEl) {
                            title = titleEl.textContent.trim();
                            break;
                        }
                    }
                    
                    // Extract price
                    let price = '';
                    for (const selector of priceSelectors) {
                        const priceEl = element.querySelector(selector);
                        if (priceEl) {
                            price = priceEl.textContent.trim()
                                .replace(/[^\d.,৳TK]/gi, '') // Clean price text
                                .trim();
                            break;
                        }
                    }
                    
                    // Extract image
                    let imageUrl = '';
                    for (const selector of imageSelectors) {
                        const imgEl = element.querySelector(selector);
                        if (imgEl) {
                            imageUrl = imgEl.src || imgEl.getAttribute('data-src') || '';
                            if (imageUrl) break;
                        }
                    }
                    
                    // Extract product URL
                    let productUrl = '';
                    for (const selector of linkSelectors) {
                        const linkEl = element.querySelector(selector);
                        if (linkEl && linkEl.href) {
                            productUrl = linkEl.href;
                            break;
                        }
                    }
                    
                    // Only add if we have at least a title or price
                    if (title || price) {
                        products.push({
                            id: `product-${index}-${Date.now()}`,
                            title: title || 'N/A',
                            price: price || 'N/A',
                            imageUrl: imageUrl || 'N/A',
                            productUrl: productUrl || 'N/A',
                            scrapedAt: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error(`Error extracting product ${index}:`, error);
                }
            });
            
            return products;
        });
    }

    /**
     * Scrape multiple pages
     */
    async scrapeMultiplePages(baseUrl, maxPages = 5) {
        const allProducts = [];
        
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            try {
                const url = pageNum === 1 ? baseUrl : `${baseUrl}?page=${pageNum}`;
                
                console.log(`\n📑 Scraping page ${pageNum}...`);
                
                const success = await this.navigateToPage(url);
                if (!success) break;
                
                // Auto-scroll to load lazy content
                await this.autoScroll();
                
                // Extract products from current page
                const products = await this.extractProducts();
                
                if (products.length === 0) {
                    console.log(`No more products found on page ${pageNum}`);
                    break;
                }
                
                allProducts.push(...products);
                console.log(`✅ Extracted ${products.length} products from page ${pageNum}`);
                
                // Be polite - add delay between pages
                if (pageNum < maxPages) {
                    await this.delay(3000);
                }
                
            } catch (error) {
                console.error(`Error scraping page ${pageNum}:`, error.message);
                break;
            }
        }
        
        return allProducts;
    }

    /**
     * Save products to JSON file
     */
    async saveToJson(products, filename = 'basketbd-products.json') {
        try {
            await fs.writeFile(
                filename, 
                JSON.stringify(products, null, 2), 
                'utf-8'
            );
            console.log(`\n💾 Saved ${products.length} products to ${filename}`);
        } catch (error) {
            console.error('Error saving file:', error);
        }
    }

    /**
     * Take screenshot for debugging
     */
    async takeScreenshot(filename = 'debug-screenshot.png') {
        try {
            await this.page.screenshot({ 
                path: filename, 
                fullPage: true 
            });
            console.log(`📸 Screenshot saved: ${filename}`);
        } catch (error) {
            console.error('Screenshot failed:', error);
        }
    }

    /**
     * Utility delay function
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clean up resources
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Browser closed');
        }
    }

    /**
     * Main scraping function
     */
    async scrapeWebsite(url, options = {}) {
        const {
            maxPages = 3,
            saveJson = true,
            takeScreenshots = true,
            waitSelector = 'body'
        } = options;
        
        try {
            await this.init();
            
            // Navigate to initial page
            const success = await this.navigateToPage(url, waitSelector);
            if (!success) {
                throw new Error('Failed to load initial page');
            }
            
            // Take screenshot if enabled
            if (takeScreenshots) {
                await this.takeScreenshot('initial-page.png');
            }
            
            // Scrape products
            const products = await this.scrapeMultiplePages(url, maxPages);
            
            // Save results
            if (saveJson) {
                await this.saveToJson(products);
            }
            
            // Generate summary
            console.log('\n📊 SCRAPING SUMMARY');
            console.log('='.repeat(40));
            console.log(`Total products scraped: ${products.length}`);
            console.log(`Pages processed: ${maxPages}`);
            
            // Show sample of scraped data
            if (products.length > 0) {
                console.log('\n📋 Sample Product:');
                console.log(JSON.stringify(products[0], null, 2));
            }
            
            return products;
            
        } catch (error) {
            console.error('❌ Scraping failed:', error);
            if (takeScreenshots) {
                await this.takeScreenshot('error-state.png');
            }
            throw error;
        } finally {
            await this.close();
        }
    }
}

// Usage Example
async function main() {
    const scraper = new BasketBDScraper();
    
    // Configuration options
    const config = {
        maxPages: 3,              // Number of pages to scrape
        saveJson: true,           // Save results to JSON file
        takeScreenshots: true,    // Take screenshots for debugging
        waitSelector: 'body'      // Change to specific selector after inspecting site
    };
    
    try {
        // Replace with actual URLs after inspecting the site
        const urlsToScrape = [
            'https://chaldal.com/search/bath',              // Homepage
            'https://thebasketbd.com/shop',          // Shop page (adjust path)
            'https://thebasketbd.com/products',      // Products page (adjust path)
            'https://thebasketbd.com/category/all'   // Category page (adjust path)
        ];
        
        // Try different URLs until one works
        let products = [];
        for (const url of urlsToScrape) {
            try {
                console.log(`\n🔍 Trying URL: ${url}`);
                products = await scraper.scrapeWebsite(url, config);
                if (products.length > 0) break;
            } catch (error) {
                console.log(`Failed with URL ${url}, trying next...`);
            }
        }
        
        // If still no products, provide guidance
        if (products.length === 0) {
            console.log('\n⚠️  No products found automatically.');
            console.log('\n📝 Next Steps:');
            console.log('1. Open thebasketbd.com in Chrome');
            console.log('2. Right-click a product and select "Inspect"');
            console.log('3. Look for class names like: .product-item, .product-card');
            console.log('4. Update the selectors in extractProducts() method');
            console.log('5. Check if the site requires login or has anti-bot protection');
        }
        
    } catch (error) {
        console.error('Script failed:', error);
    }
}

// Run the scraper
if (require.main === module) {
    main().catch(console.error);
}

module.exports = BasketBDScraper;