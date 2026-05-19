const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeOnionProducts() {
  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({ 
    headless: false, // Set to true for production, false to see the browser
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  
  // Set user agent to avoid being blocked
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  
  console.log('🌐 Navigating to the website...');
  await page.goto('https://aamaderbazar.com/?s=onion&post_type=product', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  
  // Wait for products to load
  await page.waitForSelector('.products li.product', { timeout: 10000 });
  
  console.log('📦 Scraping product information...');
  
  // Scroll to load all products
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
  
  // Extract all product data
  const products = await page.evaluate(() => {
    const productElements = document.querySelectorAll('.products li.product');
    const productsData = [];
    
    productElements.forEach((product, index) => {
      // Basic product info
      const title = product.querySelector('.woocommerce-loop-product__title')?.innerText?.trim() || '';
      const price = product.querySelector('.price')?.innerText?.trim() || '';
      const productLink = product.querySelector('.woocommerce-LoopProduct-link')?.href || '';
      const imageUrl = product.querySelector('.attachment-woocommerce_thumbnail')?.src || '';
      const imageAlt = product.querySelector('.attachment-woocommerce_thumbnail')?.alt || '';
      
      // Check if on sale
      const isOnSale = !!product.querySelector('.onsale');
      const saleBadge = product.querySelector('.onsale')?.innerText || '';
      
      // Extract product ID and SKU
      const addToCartBtn = product.querySelector('.add_to_cart_button');
      const productId = addToCartBtn?.getAttribute('data-product_id') || '';
      const productSku = addToCartBtn?.getAttribute('data-product_sku') || '';
      
      // Extract GTM4WP data (contains tags, categories, etc.)
      let gtmData = {};
      const gtmElement = product.querySelector('.gtm4wp_productdata');
      if (gtmElement) {
        try {
          const gtmAttr = gtmElement.getAttribute('data-gtm4wp_product_data');
          if (gtmAttr) {
            gtmData = JSON.parse(gtmAttr);
          }
        } catch (e) {
          console.error('Error parsing GTM data:', e);
        }
      }
      
      // Extract categories from URL
      const categories = [];
      if (productLink) {
        const urlCategories = productLink.match(/product-category\/([^\/]+)/g) || [];
        urlCategories.forEach(cat => {
          categories.push(cat.replace('product-category/', '').replace(/-/g, ' '));
        });
      }
      
      // Get stock status
      let stockStatus = 'unknown';
      if (gtmData.stockstatus) {
        stockStatus = gtmData.stockstatus;
      } else if (product.querySelector('.out-of-stock')) {
        stockStatus = 'outofstock';
      } else if (product.querySelector('.instock')) {
        stockStatus = 'instock';
      }
      
      // Get rating if available
      const rating = product.querySelector('.star-rating')?.getAttribute('style') || '';
      const ratingCount = product.querySelector('.rating-count')?.innerText || '';
      
      // Extract all tags from various sources
      const tags = new Set();
      
      // Add from GTM data
      if (gtmData.item_category) tags.add(gtmData.item_category);
      if (gtmData.item_brand && gtmData.item_brand !== '') tags.add(gtmData.item_brand);
      if (gtmData.product_type) tags.add(gtmData.product_type);
      
      // Add from categories
      categories.forEach(cat => tags.add(cat));
      
      // Add from product title keywords
      const titleKeywords = title.toLowerCase().match(/\b(\w+)\b/g) || [];
      const relevantKeywords = ['onion', 'shampoo', 'chips', 'local', 'desi', 'peyaj', 'cream', 'hair', 'fall', 'control'];
      titleKeywords.forEach(keyword => {
        if (relevantKeywords.includes(keyword.toLowerCase())) {
          tags.add(keyword);
        }
      });
      
      productsData.push({
        id: index + 1,
        productId: productId,
        title: title,
        price: price,
        priceNumeric: parseFloat(price.replace(/[^0-9.-]+/g, '')),
        currency: 'BDT',
        link: productLink,
        imageUrl: imageUrl,
        imageAlt: imageAlt,
        isOnSale: isOnSale,
        saleBadge: saleBadge,
        sku: productSku,
        stockStatus: stockStatus,
        rating: rating,
        ratingCount: ratingCount,
        categories: categories,
        tags: Array.from(tags),
        gtmData: gtmData
      });
    });
    
    return productsData;
  });
  
  console.log(`✅ Found ${products.length} products\n`);
  
  // Extract all categories and tags from the sidebar
  const sidebarData = await page.evaluate(() => {
    const categories = [];
    const tags = [];
    
    // Get product categories from sidebar
    const categoryWidget = document.querySelector('#woocommerce_product_categories-1');
    if (categoryWidget) {
      const categoryItems = categoryWidget.querySelectorAll('.cat-item');
      categoryItems.forEach(item => {
        const name = item.querySelector('a')?.innerText?.trim() || '';
        const count = item.querySelector('.count')?.innerText?.replace(/[()]/g, '') || '';
        if (name) {
          categories.push({ name: name, count: parseInt(count) || 0 });
        }
      });
    }
    
    // Get product tags from tag cloud
    const tagWidget = document.querySelector('#woocommerce_product_tag_cloud-1');
    if (tagWidget) {
      const tagItems = tagWidget.querySelectorAll('.tag-cloud-link');
      tagItems.forEach(item => {
        const name = item.innerText?.trim() || '';
        const link = item.href || '';
        if (name) {
          tags.push({ name: name, link: link });
        }
      });
    }
    
    return { categories, tags };
  });
  
  // Get page title and search info
  const pageInfo = await page.evaluate(() => {
    return {
      title: document.querySelector('title')?.innerText || '',
      searchTerm: document.querySelector('.page-title')?.innerText || '',
      resultCount: document.querySelector('.woocommerce-result-count')?.innerText || ''
    };
  });
  
  // Display results
  console.log('=' .repeat(80));
  console.log(`📊 SEARCH RESULTS: ${pageInfo.title}`);
  console.log(`🔍 ${pageInfo.resultCount}`);
  console.log('=' .repeat(80));
  
  products.forEach(product => {
    console.log(`\n📦 Product #${product.id}`);
    console.log(`   📝 Title: ${product.title}`);
    console.log(`   💰 Price: ${product.price}`);
    console.log(`   🏷️  Categories: ${product.categories.join(', ') || 'None'}`);
    console.log(`   🔖 Tags: ${product.tags.join(', ') || 'None'}`);
    console.log(`   📊 Stock: ${product.stockStatus}`);
    if (product.isOnSale) console.log(`   🔥 ON SALE! ${product.saleBadge}`);
    console.log(`   🔗 Link: ${product.link}`);
  });
  
  console.log('\n' + '=' .repeat(80));
  console.log(`📂 SIDEBAR CATEGORIES (${sidebarData.categories.length} total):`);
  console.log('=' .repeat(80));
  sidebarData.categories.slice(0, 20).forEach(cat => {
    console.log(`   • ${cat.name} (${cat.count} products)`);
  });
  
  console.log('\n' + '=' .repeat(80));
  console.log(`🏷️  PRODUCT TAGS (${sidebarData.tags.length} total):`);
  console.log('=' .repeat(80));
  sidebarData.tags.forEach(tag => {
    console.log(`   • ${tag.name}`);
  });
  
  // Get unique tags from all products
  const allProductTags = [...new Set(products.flatMap(p => p.tags))];
  console.log('\n' + '=' .repeat(80));
  console.log(`✨ UNIQUE TAGS FOUND IN PRODUCTS (${allProductTags.length} total):`);
  console.log('=' .repeat(80));
  allProductTags.sort().forEach(tag => {
    console.log(`   • ${tag}`);
  });
  
  // Create a comprehensive data object
  const outputData = {
    scrapedAt: new Date().toISOString(),
    url: 'https://aamaderbazar.com/?s=onion&post_type=product',
    searchInfo: pageInfo,
    summary: {
      totalProducts: products.length,
      categoriesCount: sidebarData.categories.length,
      tagsCount: sidebarData.tags.length,
      uniqueProductTags: allProductTags.length,
      productsOnSale: products.filter(p => p.isOnSale).length,
      availableProducts: products.filter(p => p.stockStatus === 'instock').length
    },
    sidebarCategories: sidebarData.categories,
    sidebarTags: sidebarData.tags,
    products: products
  };
  
  // Save to JSON file
  fs.writeFileSync('onion_products_complete.json', JSON.stringify(outputData, null, 2));
  console.log('\n✅ Complete data saved to onion_products_complete.json');
  
  // Generate a simple HTML report
  const htmlReport = generateHTMLReport(products, sidebarData, allProductTags);
  fs.writeFileSync('products_report.html', htmlReport);
  console.log('📄 HTML report saved to products_report.html');
  
  await browser.close();
  console.log('\n🏁 Scraping completed!');
  
  return outputData;
}

function generateHTMLReport(products, sidebarData, allTags) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Onion Products Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
        h1 { color: #ef2323; }
        .summary { background: #e8f5e9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .product { border: 1px solid #ddd; margin-bottom: 15px; padding: 15px; border-radius: 5px; }
        .product-title { font-size: 18px; font-weight: bold; color: #333; }
        .product-price { color: #ef2323; font-size: 20px; font-weight: bold; }
        .product-tags { margin-top: 10px; }
        .tag { display: inline-block; background: #e0e0e0; padding: 3px 8px; margin: 2px; border-radius: 3px; font-size: 12px; }
        .sale-badge { background: #ff9800; color: white; padding: 2px 8px; border-radius: 3px; display: inline-block; margin-left: 10px; }
        .categories-list, .tags-list { display: flex; flex-wrap: wrap; gap: 5px; }
        .category-item, .tag-item { background: #2196f3; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; }
        .section { margin-top: 30px; }
        h2 { border-bottom: 2px solid #ef2323; padding-bottom: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧅 Onion Products Scraping Report</h1>
        
        <div class="summary">
            <h3>Summary</h3>
            <p>📦 Total Products: ${products.length}</p>
            <p>🔥 Products on Sale: ${products.filter(p => p.isOnSale).length}</p>
            <p>🏷️  Unique Tags: ${allTags.length}</p>
            <p>📂 Categories: ${sidebarData.categories.length}</p>
            <p>🕐 Scraped: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="section">
            <h2>📦 Products (${products.length})</h2>
            ${products.map(product => `
                <div class="product">
                    <div class="product-title">
                        ${product.title}
                        ${product.isOnSale ? '<span class="sale-badge">ON SALE!</span>' : ''}
                    </div>
                    <div class="product-price">${product.price}</div>
                    <div>📊 Stock: ${product.stockStatus}</div>
                    <div>🏷️  Categories: ${product.categories.join(', ')}</div>
                    <div class="product-tags">
                        Tags: ${product.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                    <div style="margin-top: 10px;">
                        <a href="${product.link}" target="_blank">View Product →</a>
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="section">
            <h2>🏷️ All Product Tags (${allTags.length})</h2>
            <div class="tags-list">
                ${allTags.map(tag => `<span class="tag-item">${tag}</span>`).join('')}
            </div>
        </div>
        
        <div class="section">
            <h2>📂 Categories (${sidebarData.categories.length})</h2>
            <div class="categories-list">
                ${sidebarData.categories.map(cat => `<span class="category-item">${cat.name} (${cat.count})</span>`).join('')}
            </div>
        </div>
    </div>
</body>
</html>
  `;
}

// Run the scraper
scrapeOnionProducts().catch(error => {
  console.error('❌ Error during scraping:', error);
});