// extractPotato_puppeteer.js
const puppeteer = require('puppeteer');

async function extractPotatoProducts() {
  let browser;
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: false, // Set to true for production, false for debugging
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Navigate to the search results page
    const searchUrl = 'https://www.thebasketbd.com/catalogsearch/result/?q=rice';
    console.log('🔍 Navigating to:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for products to load (adjust selector based on actual page structure)
    await page.waitForSelector('.product-item, .product-item-info, .product-details', { 
      timeout: 10000 
    }).catch(() => {
      console.log('⚠️ Product selector not found, dumping page content...');
    });
    
    // Scroll to load all products (if lazy loading)
    await autoScroll(page);
    
    // Extract product data
    const products = await page.evaluate(() => {
      const productItems = [];
      
      // Try multiple possible selectors for product containers
      const selectors = [
        '.product-item',
        '.product-item-info',
        '.item.product.product-item',
        '.products-grid .item',
        '.product-listing-item',
        '[data-container="product-grid"] .product-item'
      ];
      
      let productElements = [];
      for (const selector of selectors) {
        productElements = document.querySelectorAll(selector);
        if (productElements.length > 0) {
          console.log(`Found ${productElements.length} products using selector: ${selector}`);
          break;
        }
      }
      
      if (productElements.length === 0) {
        // Fallback: look for any elements that might contain product data
        productElements = document.querySelectorAll('[class*="product"], [class*="item"]');
      }
      
      productElements.forEach((element, index) => {
        // Try different selectors for product name
        const nameSelectors = [
          '.product-item-name',
          '.product-name',
          'h2.product-name',
          'a.product-item-link',
          '[class*="product"] [class*="name"]',
          '.product-details .product-title'
        ];
        
        let name = '';
        for (const selector of nameSelectors) {
          const nameElement = element.querySelector(selector);
          if (nameElement) {
            name = nameElement.textContent.trim();
            break;
          }
        }
        
        // Try different selectors for price
        const priceSelectors = [
          '.price',
          '.product-price',
          '.price-wrapper',
          '.special-price .price',
          '.final-price .price',
          '[class*="price"]'
        ];
        
        let price = '';
        for (const selector of priceSelectors) {
          const priceElement = element.querySelector(selector);
          if (priceElement) {
            price = priceElement.textContent.trim();
            break;
          }
        }
        
        // Try to get product URL
        let productUrl = '';
        const linkElement = element.querySelector('a');
        if (linkElement && linkElement.href) {
          productUrl = linkElement.href;
        }
        
        // Try to get image URL
        let imageUrl = '';
        const imgElement = element.querySelector('img');
        if (imgElement && (imgElement.src || imgElement.getAttribute('data-src'))) {
          imageUrl = imgElement.src || imgElement.getAttribute('data-src');
        }
        
        // Only add if we have at least a name
        if (name) {
          productItems.push({
            id: index + 1,
            name: name,
            price: price || 'Price not available',
            url: productUrl,
            image: imageUrl,
            source: 'rendered_page'
          });
        }
      });
      
      return productItems;
    });
    
    console.log('\n📦 EXTRACTED PRODUCTS:\n');
    console.log(JSON.stringify(products, null, 2));
    console.log(`\n✅ Total products extracted: ${products.length}`);
    
    // Take screenshot for verification
    await page.screenshot({ path: 'search_results.png', fullPage: true });
    console.log('\n📸 Screenshot saved as: search_results.png');
    
    // Get page title for verification
    const pageTitle = await page.title();
    console.log(`📄 Page title: ${pageTitle}`);
    
    // Also try to get any additional product data from the API if available
    console.log('\n🔍 Attempting to capture network requests...');
    
    return products;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
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
      }, 200);
    });
  });
}

// Alternative: More detailed extraction with logging
async function extractWithDebug() {
  let browser;
  
  try {
    browser = await puppeteer.launch({ 
      headless: false,
      args: ['--no-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Enable console logging from the page
    page.on('console', msg => console.log('🌐 PAGE LOG:', msg.text()));
    
    await page.goto('https://www.thebasketbd.com/catalogsearch/result/?q=potato', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait a bit for JavaScript to render
    await page.waitForTimeout(3000);
    
    // Get the full HTML for debugging
    const html = await page.content();
    console.log('\n📄 HTML length:', html.length);
    
    // Try to find any product-related content
    const hasProducts = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasPotato: bodyText.includes('potato') || bodyText.includes('Potato'),
        sampleText: bodyText.substring(0, 500),
        productElements: document.querySelectorAll('[class*="product"]').length
      };
    });
    
    console.log('\n🔍 Page analysis:', hasProducts);
    
    // Extract all text content for debugging
    const allText = await page.evaluate(() => document.body.innerText);
    console.log('\n📝 Page text preview:', allText.substring(0, 1000));
    
    // Try to find if products are in a different format (like JSON-LD)
    const jsonLd = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const data = [];
      scripts.forEach(script => {
        try {
          data.push(JSON.parse(script.textContent));
        } catch(e) {}
      });
      return data;
    });
    
    if (jsonLd.length > 0) {
      console.log('\n📊 Found JSON-LD data:', JSON.stringify(jsonLd, null, 2));
    }
    
    // Try to extract products using common Magento patterns
    const magentoProducts = await page.evaluate(() => {
      // Check for Magento's data layer
      if (window.dataLayer) {
        const productEvents = window.dataLayer.filter(item => 
          item.ecommerce && item.ecommerce.detail && item.ecommerce.detail.products
        );
        return productEvents;
      }
      return null;
    });
    
    if (magentoProducts) {
      console.log('\n📊 Found Magento dataLayer products:', magentoProducts);
    }
    
    // Take a screenshot
    await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
    console.log('\n📸 Debug screenshot saved: debug_screenshot.png');
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  } finally {
    if (browser) await browser.close();
  }
}

// Run the extraction
console.log('🚀 Starting product extraction...\n');
extractPotatoProducts().then(products => {
  if (products.length === 0) {
    console.log('\n⚠️ No products found with standard extraction. Running debug mode...');
    extractWithDebug();
  }
});