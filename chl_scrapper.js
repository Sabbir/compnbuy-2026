// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const ObjectsToCsv = require('objects-to-csv');
const fs = require('fs').promises; // Using promises for async file operations

const SEARCH_TERM = 'milk'; // Change this to any product you want to search for

// A small delay to be respectful to the server
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeChaldalSearch(searchTerm) {
    const url = `https://chaldal.com/search?q=${encodeURIComponent(searchTerm)}`;
    console.log(`Scraping: ${url}`);

    try {
        // 1. Fetch the HTML of the search results page
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // 2. Find the script tag with the product data
        // We look for a script tag containing the string "window.__INITIAL_STATE__"
        let productData = null;
        $('script').each((i, el) => {
            const scriptContent = $(el).html();
            if (scriptContent && scriptContent.includes('window.__INITIAL_STATE__')) {
                // Extract the JSON string and parse it
                const jsonString = scriptContent.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
                if (jsonString && jsonString[1]) {
                    productData = JSON.parse(jsonString[1]);
                    return false; // break the loop
                }
            }
        });

        if (!productData) {
            console.error('Could not find product data on the page. The site structure might have changed.');
            return;
        }

        // 3. Navigate the JSON object to find the list of products
        // The exact path might change, so inspect the 'productData' object if this fails
        const products = productData?.search?.products || [];

        if (products.length === 0) {
            console.log('No products found for the given search term.');
            return;
        }

        // 4. Map the raw product data into a clean, structured format
        const extractedData = products.map(product => ({
            name: product.name,
            price: product.price, // This is usually the discounted price
            originalPrice: product.originalPrice,
            quantity: product.quantity,
            sku: product.sku,
            // Add a link to the product page
            url: `https://chaldal.com/${product.slug}`
        }));

        console.log(`Found ${extractedData.length} products.`);

        // 5. Save the data to a CSV file
        const csv = new ObjectsToCsv(extractedData);
        const filename = `chaldal-${searchTerm}-${Date.now()}.csv`;
        await csv.toDisk(`./${filename}`);
        console.log(`Data saved to ${filename}`);

        // 6. Save to JSON file as well (good for debugging)
        await fs.writeFile(
            `./${filename.replace('.csv', '.json')}`,
            JSON.stringify(extractedData, null, 2)
        );
        console.log(`Data also saved to JSON for inspection.`);

    } catch (error) {
        console.error('An error occurred during scraping:', error.message);
    }
}

// Run the scraper with a delay to avoid rate limiting
(async () => {
    await scrapeChaldalSearch(SEARCH_TERM);
    await delay(1000); // Wait for 1 second
    // You can call the function again with a different search term here
})();