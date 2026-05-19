const puppeteer = require('puppeteer');

async function scrapeProductSearch(url) {
    const browser = await puppeteer.launch({
        headless: true, // Set to false if you want to see the browser
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        // Set user agent to avoid blocking
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to the URL
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait for product items to load
        await page.waitForSelector('.p-item', { timeout: 10000 });

        // Scrape product information
        const products = await page.evaluate(() => {
            const items = document.querySelectorAll('.p-item');
            const productList = [];

            items.forEach(item => {
                const product = {};

                // Product name and URL
                const nameElement = item.querySelector('.p-item-name a');
                if (nameElement) {
                    product.name = nameElement.textContent.trim();
                    product.url = nameElement.href;
                }

                // Product image
                const imgElement = item.querySelector('.p-item-img img');
                if (imgElement) {
                    product.image = imgElement.src;
                    product.imageAlt = imgElement.alt || '';
                }

                // Price (regular or discounted)
                const priceSpan = item.querySelector('.p-item-price span');
                const priceNew = item.querySelector('.price-new');
                const priceOld = item.querySelector('.price-old');

                if (priceNew && priceOld) {
                    product.price = priceNew.textContent.trim();
                    product.oldPrice = priceOld.textContent.trim();
                    product.hasDiscount = true;
                } else if (priceSpan) {
                    product.price = priceSpan.textContent.trim();
                    product.hasDiscount = false;
                }

                // Discount/Save amount
                const saveElement = item.querySelector('.mark');
                if (saveElement) {
                    product.saveAmount = saveElement.textContent.trim();
                }

                // Short description (features)
                const descriptionElement = item.querySelector('.short-description');
                if (descriptionElement) {
                    const features = [];
                    const listItems = descriptionElement.querySelectorAll('li');
                    listItems.forEach(li => {
                        features.push(li.textContent.trim());
                    });
                    product.features = features;
                }

                // Check if product is in stock/available
                product.available = true;

                productList.push(product);
            });

            return productList;
        });

        // Get pagination information
        const paginationInfo = await page.evaluate(() => {
            const pagination = {};
            
            // Get current page and total pages
            const activePage = document.querySelector('.pagination .active');
            if (activePage) {
                pagination.currentPage = parseInt(activePage.textContent);
            }

            const paginationLinks = document.querySelectorAll('.pagination a');
            const nextLink = Array.from(paginationLinks).find(link => link.textContent === 'NEXT');
            const prevLink = Array.from(paginationLinks).find(link => link.textContent === 'PREV');
            
            pagination.hasNext = !!nextLink;
            pagination.hasPrev = !!prevLink && prevLink.textContent !== 'disabled';
            
            if (nextLink && nextLink.href) {
                pagination.nextPageUrl = nextLink.href;
            }
            if (prevLink && prevLink.href) {
                pagination.prevPageUrl = prevLink.href;
            }

            // Get showing info
            const showingInfo = document.querySelector('.bottom-bar .text-right p');
            if (showingInfo) {
                pagination.showingInfo = showingInfo.textContent.trim();
            }

            return pagination;
        });

        // Get search query
        const searchQuery = await page.evaluate(() => {
            const searchInput = document.querySelector('#input-search');
            return searchInput ? searchInput.value : '';
        });

        return {
            searchQuery: searchQuery,
            totalProductsFound: products.length,
            products: products,
            pagination: paginationInfo,
            url: url
        };

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// Function to scrape multiple pages
async function scrapeMultiplePages(baseUrl, maxPages = 5) {
    let allProducts = [];
    let currentUrl = baseUrl;
    let pageNum = 1;

    console.log(`Starting scraping from ${baseUrl}`);
    console.log('----------------------------------------');

    while (currentUrl && pageNum <= maxPages) {
        console.log(`Scraping page ${pageNum}...`);
        
        const result = await scrapeProductSearch(currentUrl);
        allProducts.push(...result.products);
        
        console.log(`Found ${result.products.length} products on page ${pageNum}`);
        
        // Check if there's a next page
        if (result.pagination.hasNext && result.pagination.nextPageUrl && pageNum < maxPages) {
            currentUrl = result.pagination.nextPageUrl;
            pageNum++;
            // Add a small delay to be respectful to the server
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            break;
        }
    }

    return {
        totalPagesScraped: pageNum,
        totalProducts: allProducts.length,
        products: allProducts
    };
}

// Function to save results to a JSON file
const fs = require('fs');

async function saveToJson(data, filename = 'scraped_products.json') {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`Data saved to ${filename}`);
}

// Main execution
async function main() {
    const searchUrl = 'https://www.startech.com.bd/product/search?&search=mouse';
    
    try {
        // Scrape single page
        console.log('=== Scraping Single Page ===');
        const singlePageResult = await scrapeProductSearch(searchUrl);
        console.log(`Found ${singlePageResult.products.length} products for "${singlePageResult.searchQuery}"`);
        console.log(`Current page: ${singlePageResult.pagination.currentPage}`);
        console.log(`Has next page: ${singlePageResult.pagination.hasNext}`);
        
        // Display first few products as sample
        console.log('\nSample products:');
        singlePageResult.products.slice(0, 3).forEach((product, index) => {
            console.log(`\n${index + 1}. ${product.name}`);
            console.log(`   Price: ${product.price}`);
            if (product.oldPrice) console.log(`   Old Price: ${product.oldPrice}`);
            if (product.saveAmount) console.log(`   Save: ${product.saveAmount}`);
            console.log(`   URL: ${product.url}`);
        });

        // Save single page results
        await saveToJson(singlePageResult, 'single_page_products.json');

        // Scrape multiple pages (optional)
        console.log('\n=== Scraping Multiple Pages ===');
        const multiPageResult = await scrapeMultiplePages(searchUrl, 3); // Scrape first 3 pages
        console.log(`\nScraping complete!`);
        console.log(`Total pages scraped: ${multiPageResult.totalPagesScraped}`);
        console.log(`Total products found: ${multiPageResult.totalProducts}`);
        
        // Save multi-page results
        await saveToJson(multiPageResult, 'multi_page_products.json');

        // Generate a summary report
        const summary = {
            timestamp: new Date().toISOString(),
            searchUrl: searchUrl,
            summary: {
                singlePage: {
                    productsCount: singlePageResult.products.length,
                    hasNextPage: singlePageResult.pagination.hasNext
                },
                multiPage: {
                    pagesScraped: multiPageResult.totalPagesScraped,
                    totalProducts: multiPageResult.totalProducts
                }
            },
            priceRanges: {
                lowestPrice: getLowestPrice(multiPageResult.products),
                highestPrice: getHighestPrice(multiPageResult.products),
                averagePrice: getAveragePrice(multiPageResult.products)
            }
        };

        await saveToJson(summary, 'scraping_summary.json');
        console.log('\nSummary report saved!');

    } catch (error) {
        console.error('Scraping failed:', error.message);
    }
}

// Helper functions for price analysis
function extractNumericPrice(priceString) {
    if (!priceString) return null;
    const match = priceString.match(/(\d+(?:,\d+)?)/);
    if (match) {
        return parseInt(match[1].replace(/,/g, ''));
    }
    return null;
}

function getLowestPrice(products) {
    let lowest = Infinity;
    products.forEach(product => {
        const price = extractNumericPrice(product.price);
        if (price && price < lowest) lowest = price;
    });
    return lowest !== Infinity ? `${lowest}৳` : 'N/A';
}

function getHighestPrice(products) {
    let highest = -Infinity;
    products.forEach(product => {
        const price = extractNumericPrice(product.price);
        if (price && price > highest) highest = price;
    });
    return highest !== -Infinity ? `${highest}৳` : 'N/A';
}

function getAveragePrice(products) {
    let sum = 0;
    let count = 0;
    products.forEach(product => {
        const price = extractNumericPrice(product.price);
        if (price) {
            sum += price;
            count++;
        }
    });
    return count > 0 ? `${Math.round(sum / count)}৳` : 'N/A';
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = {
    scrapeProductSearch,
    scrapeMultiplePages,
    saveToJson
};