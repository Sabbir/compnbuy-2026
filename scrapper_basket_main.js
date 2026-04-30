// custom-scraper.js - After inspecting the actual site
const BasketBDScraper = require('./scraper');

class CustomBasketBDScraper extends BasketBDScraper {
    async extractProducts() {
        return await this.page.evaluate(() => {
            const products = [];
            
            // REPLACE THESE SELECTORS after inspecting thebasketbd.com
            const productSelector = '.product'; // Change this!
            const titleSelector = '.product-title'; // Change this!
            const priceSelector = '.price'; // Change this!
            const imageSelector = '.product-image img'; // Change this!
            const linkSelector = 'a.product-link'; // Change this!
            
            const productElements = document.querySelectorAll(productSelector);
            
            productElements.forEach((element, index) => {
                const title = element.querySelector(titleSelector)?.textContent.trim() || '';
                const price = element.querySelector(priceSelector)?.textContent.trim() || '';
                const image = element.querySelector(imageSelector)?.src || '';
                const link = element.querySelector(linkSelector)?.href || '';
                
                if (title || price) {
                    products.push({
                        title,
                        price,
                        image,
                        link,
                        scrapedAt: new Date().toISOString()
                    });
                }
            });
            
            return products;
        });
    }
}

// Usage
async function customScrape() {
    const scraper = new CustomBasketBDScraper();
    
    try {
        const products = await scraper.scrapeWebsite('https://thebasketbd.com/', {
            maxPages: 5,
            saveJson: true
        });
        
        console.log(`Successfully scraped ${products.length} products`);
        
    } catch (error) {
        console.error('Custom scraping failed:', error);
    }
}

customScrape();