const puppeteer = require('puppeteer');

async function extractProductInfo() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Navigate to the page
    await page.goto('https://blucheez.fashion/search?q=kurta&type=product', {
        waitUntil: 'networkidle2'
    });
    
    // Extract product information
    const products = await page.evaluate(() => {
        const productElements = document.querySelectorAll('.t4s-product');
        const productsData = [];
        
        productElements.forEach((product, index) => {
            // Get product ID from data-product-options attribute
            const productOptions = product.getAttribute('data-product-options');
            let productId = null;
            let productHandle = null;
            let productAvailable = null;
            let comparePrice = null;
            let price = null;
            
            if (productOptions) {
                try {
                    const options = JSON.parse(productOptions);
                    productId = options.id;
                    productHandle = options.handle;
                    productAvailable = options.available;
                    comparePrice = options.compare_at_price;
                    price = options.price;
                } catch(e) {
                    console.error('Error parsing product options', e);
                }
            }
            
            // Get product title
            const titleElement = product.querySelector('.t4s-product-title a');
            const title = titleElement ? titleElement.innerText.trim() : '';
            
            // Get product URL
            const productUrl = titleElement ? titleElement.getAttribute('href') : '';
            
            // Get product image
            const imgElement = product.querySelector('.t4s-product-main-img');
            let imgSrc = '';
            if (imgElement) {
                imgSrc = imgElement.getAttribute('data-src') || imgElement.getAttribute('src');
                if (imgSrc && imgSrc.includes('?v=')) {
                    imgSrc = imgSrc.split('?')[0];
                }
            }
            
            // Get price information
            const priceElement = product.querySelector('.t4s-product-price');
            let regularPrice = '';
            let salePrice = '';
            
            if (priceElement) {
                const delElement = priceElement.querySelector('del');
                const insElement = priceElement.querySelector('ins');
                
                if (delElement && insElement) {
                    // Product is on sale
                    regularPrice = delElement.innerText.trim();
                    salePrice = insElement.innerText.trim();
                } else {
                    // Regular price
                    regularPrice = priceElement.innerText.trim();
                }
            }
            
            // Get variant count if available
            const variantElements = product.querySelectorAll('[data-variant-id]');
            const variants = [];
            
            variantElements.forEach(variant => {
                const variantId = variant.getAttribute('data-variant-id');
                const variantTitle = variant.getAttribute('data-variant-title');
                if (variantId && variantTitle) {
                    variants.push({
                        id: variantId,
                        title: variantTitle
                    });
                }
            });
            
            productsData.push({
                index: index + 1,
                productId: productId,
                handle: productHandle,
                title: title,
                url: productUrl,
                imageUrl: imgSrc,
                available: productAvailable,
                regularPrice: regularPrice,
                salePrice: salePrice,
                compareAtPrice: comparePrice ? `Tk ${comparePrice}` : null,
                currentPrice: price ? `Tk ${price}` : null,
                variantCount: variants.length,
                variants: variants
            });
        });
        
        return productsData;
    });
    
    // Get additional information from the page
    const pageInfo = await page.evaluate(() => {
        // Get search results count
        const headingElement = document.querySelector('.title-head');
        let resultCount = 0;
        let searchTerm = '';
        
        if (headingElement) {
            const headingText = headingElement.innerText;
            const match = headingText.match(/(\d+)\s+Search Results for:\s+["'](.+?)["']/);
            if (match) {
                resultCount = parseInt(match[1]);
                searchTerm = match[2];
            }
        }
        
        // Get pagination info
        const loadMoreBtn = document.querySelector('[data-load-more]');
        const hasMoreProducts = !!loadMoreBtn;
        
        const currentProductsCount = document.querySelectorAll('.t4s-product').length;
        
        const progressBar = document.querySelector('.t4s-lm-bar--current');
        let percentageLoaded = 0;
        if (progressBar) {
            const width = progressBar.style.width;
            if (width) {
                percentageLoaded = parseFloat(width);
            }
        }
        
        return {
            searchTerm: searchTerm,
            totalResultsFound: resultCount,
            productsDisplayed: currentProductsCount,
            hasMoreProducts: hasMoreProducts,
            percentageLoaded: percentageLoaded
        };
    });
    
    // Combine all information
    const result = {
        pageMetadata: {
            url: page.url(),
            title: await page.title(),
            searchQuery: pageInfo.searchTerm,
            totalResults: pageInfo.totalResultsFound,
            productsDisplayed: pageInfo.productsDisplayed,
            hasMoreProducts: pageInfo.hasMoreProducts,
            percentageLoaded: pageInfo.percentageLoaded
        },
        products: products
    };
    
    // Save to JSON file (optional)
    const fs = require('fs');
    fs.writeFileSync(
        'blucheez_products.json', 
        JSON.stringify(result, null, 2)
    );
    console.log('Product data saved to blucheez_products.json');
    
    // Print summary
    console.log(`\n=== EXTRACTION SUMMARY ===`);
    console.log(`Search Term: ${result.pageMetadata.searchQuery}`);
    console.log(`Total Results Found: ${result.pageMetadata.totalResults}`);
    console.log(`Products Displayed: ${result.pageMetadata.productsDisplayed}`);
    console.log(`Has More Products: ${result.pageMetadata.hasMoreProducts}`);
    console.log(`\n=== PRODUCTS ===`);
    
    products.forEach(product => {
        console.log(`\n${product.index}. ${product.title}`);
        console.log(`   URL: ${product.url}`);
        console.log(`   Price: ${product.salePrice || product.regularPrice}`);
        if (product.regularPrice && product.salePrice) {
            console.log(`   Original: ${product.regularPrice}`);
        }
        console.log(`   Available: ${product.available}`);
        if (product.variantCount > 0) {
            console.log(`   Variants: ${product.variantCount}`);
        }
    });
    
    await browser.close();
    return result;
}

// Alternative: Extract from HTML file directly (if you saved the HTML)
async function extractFromHtmlFile(htmlFilePath) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Read the HTML file
    const fs = require('fs');
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf8');
    
    // Set the HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Extract product information (same as above)
    const products = await page.evaluate(() => {
        const productElements = document.querySelectorAll('.t4s-product');
        const productsData = [];
        
        productElements.forEach((product, index) => {
            const productOptions = product.getAttribute('data-product-options');
            let productId = null;
            let productHandle = null;
            
            if (productOptions) {
                try {
                    const options = JSON.parse(productOptions);
                    productId = options.id;
                    productHandle = options.handle;
                } catch(e) {}
            }
            
            const titleElement = product.querySelector('.t4s-product-title a');
            const title = titleElement ? titleElement.innerText.trim() : '';
            const productUrl = titleElement ? titleElement.getAttribute('href') : '';
            
            const priceElement = product.querySelector('.t4s-product-price');
            let price = '';
            if (priceElement) {
                price = priceElement.innerText.trim();
            }
            
            productsData.push({
                index: index + 1,
                productId: productId,
                handle: productHandle,
                title: title,
                url: productUrl,
                price: price
            });
        });
        
        return productsData;
    });
    
    console.log(`Extracted ${products.length} products from HTML file`);
    console.log(products);
    
    await browser.close();
    return products;
}

// Usage
// For live website:
extractProductInfo().catch(console.error);

// For local HTML file:
// extractFromHtmlFile('path/to/your/saved-page.html').catch(console.error);