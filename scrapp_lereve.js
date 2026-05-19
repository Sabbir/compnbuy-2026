const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeSareeProducts() {
  let browser;
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: true, // Set to false to see the browser in action
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set user agent to avoid blocking
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the saree category page
    const url = 'https://www.lerevecraze.com/product-category/saree/';
    console.log(`Navigating to: ${url}`);
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for products to load
    await page.waitForSelector('.lrv-product-grid', { timeout: 10000 });
    
    // Extract product data
    const products = await page.evaluate(() => {
      const productElements = document.querySelectorAll('.lrv-product-grid');
      const productsData = [];
      
      productElements.forEach((product, index) => {
        try {
          // Extract product name
          const nameElement = product.querySelector('.text-truncate a');
          const name = nameElement ? nameElement.innerText.trim() : 'N/A';
          
          // Extract product URL
          const productUrl = nameElement ? nameElement.getAttribute('href') : 'N/A';
          
          // Extract price
          const priceElement = product.querySelector('.price .amount');
          let price = priceElement ? priceElement.innerText.trim() : 'N/A';
          price = price.replace('৳', '').trim();
          
          // Extract images (all images from the carousel)
          const images = [];
          const imgElements = product.querySelectorAll('.embla__slide img');
          imgElements.forEach(img => {
            const imgSrc = img.getAttribute('src');
            if (imgSrc && !images.includes(imgSrc)) {
              images.push(imgSrc);
            }
          });
          
          // Extract all tags/attributes from the page
          const tags = [];
          
          // Look for color information (might be in the product name or separate element)
          if (name.toLowerCase().includes('saree')) {
            const colorMatch = name.match(/^(.*?)\s+(?:Cotton|Half-silk|Nakshi)?\s*Saree/i);
            if (colorMatch && colorMatch[1]) {
              tags.push({
                type: 'Color',
                value: colorMatch[1].trim()
              });
            }
          }
          
          // Check for fabric type in name
          if (name.toLowerCase().includes('cotton')) {
            tags.push({
              type: 'Fabric',
              value: 'Cotton'
            });
          } else if (name.toLowerCase().includes('half-silk')) {
            tags.push({
              type: 'Fabric',
              value: 'Half Silk'
            });
          } else if (name.toLowerCase().includes('nakshi')) {
            tags.push({
              type: 'Fabric',
              value: 'Cotton Nakshi'
            });
          }
          
          // Try to find attributes from the page (if visible)
          const attributeElements = product.querySelectorAll('[class*="attribute"], [class*="tag"], [class*="meta"]');
          attributeElements.forEach(elem => {
            const text = elem.innerText.trim();
            if (text && text.length > 0 && text.length < 100) {
              if (text.includes('Cotton') || text.includes('Silk')) {
                tags.push({ type: 'Fabric', value: text });
              } else if (text.includes('wash') || text.includes('care')) {
                tags.push({ type: 'Wash Care', value: text });
              } else if (text.match(/^(White|Black|Red|Blue|Green|Yellow|Purple|Pink|Orange|Brown|Teal|Gray|Off-white)/i)) {
                tags.push({ type: 'Color', value: text });
              }
            }
          });
          
          productsData.push({
            id: index + 1,
            name: name,
            price: price,
            currency: 'BDT',
            url: productUrl.startsWith('/') ? `https://www.lerevecraze.com${productUrl}` : productUrl,
            images: images,
            tags: tags,
            fullProductUrl: productUrl
          });
          
        } catch (error) {
          console.error(`Error extracting product ${index + 1}:`, error);
        }
      });
      
      return productsData;
    });
    
    console.log(`\n✅ Successfully scraped ${products.length} products\n`);
    
    // Also try to extract product data from the embedded JSON in the page
    const jsonData = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent;
        if (content && content.includes('initialProducts')) {
          const match = content.match(/initialProducts":(.*?)\]\}/s);
          if (match) {
            try {
              // Extract the products array
              const startIndex = content.indexOf('"initialProducts":');
              if (startIndex !== -1) {
                const endIndex = content.indexOf('],"totalCount"', startIndex);
                if (endIndex !== -1) {
                  const productsStr = content.substring(startIndex + 18, endIndex + 1);
                  return JSON.parse(productsStr);
                }
              }
            } catch (e) {
              console.error('Error parsing JSON:', e);
            }
          }
        }
      }
      return null;
    });
    
    // Display product details
    console.log('='.repeat(80));
    console.log('SCRAPED PRODUCTS WITH TAGS');
    console.log('='.repeat(80));
    
    products.forEach((product, index) => {
      console.log(`\n📦 Product ${product.id}: ${product.name}`);
      console.log(`   💰 Price: ৳${product.price}`);
      console.log(`   🔗 URL: ${product.url}`);
      console.log(`   🖼️ Images: ${product.images.length} image(s)`);
      console.log(`   🏷️ Tags (${product.tags.length}):`);
      
      if (product.tags.length > 0) {
        product.tags.forEach(tag => {
          console.log(`      - ${tag.type}: ${tag.value}`);
        });
      } else {
        console.log(`      - No tags found on page`);
      }
    });
    
    // Collect all unique tags from all products
    const allTags = new Map();
    products.forEach(product => {
      product.tags.forEach(tag => {
        if (!allTags.has(tag.type)) {
          allTags.set(tag.type, new Set());
        }
        allTags.get(tag.type).add(tag.value);
      });
    });
    
    // Display summary of all tags
    console.log('\n' + '='.repeat(80));
    console.log('ALL TAGS FOUND ACROSS PRODUCTS');
    console.log('='.repeat(80));
    
    for (const [tagType, tagValues] of allTags.entries()) {
      console.log(`\n📌 ${tagType}:`);
      Array.from(tagValues).sort().forEach(value => {
        console.log(`   - ${value}`);
      });
    }
    
    // If JSON data is available, display detailed attributes
    if (jsonData && jsonData.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('DETAILED ATTRIBUTES FROM EMBEDDED DATA');
      console.log('='.repeat(80));
      
      const allAttributes = new Map();
      
      jsonData.forEach((product, index) => {
        console.log(`\n📦 ${product.name || 'Product ' + (index + 1)}:`);
        if (product.attributes && product.attributes.length > 0) {
          product.attributes.forEach(attr => {
            if (attr.name && attr.options) {
              const attrValue = attr.options.join(', ');
              console.log(`   ${attr.name}: ${attrValue}`);
              
              if (!allAttributes.has(attr.name)) {
                allAttributes.set(attr.name, new Set());
              }
              allAttributes.get(attr.name).add(attrValue);
            }
          });
        }
        
        // Also show wash care if available
        if (product.wash_care) {
          console.log(`   Wash Care: ${product.wash_care}`);
        }
      });
      
      console.log('\n' + '='.repeat(80));
      console.log('UNIQUE ATTRIBUTES/TAGS FROM EMBEDDED DATA');
      console.log('='.repeat(80));
      
      for (const [attrName, attrValues] of allAttributes.entries()) {
        console.log(`\n📌 ${attrName}:`);
        Array.from(attrValues).sort().forEach(value => {
          console.log(`   - ${value}`);
        });
      }
    }
    
    // Save to files
    const output = {
      scrapedDate: new Date().toISOString(),
      totalProducts: products.length,
      products: products,
      allTags: Object.fromEntries(
        Array.from(allTags.entries()).map(([key, value]) => [key, Array.from(value)])
      )
    };
    
    fs.writeFileSync('saree_products.json', JSON.stringify(output, null, 2));
    console.log('\n✅ Data saved to saree_products.json');
    
    // Create a CSV export
    let csvContent = 'ID,Product Name,Price (BDT),URL,Tags\n';
    products.forEach(product => {
      const tagsStr = product.tags.map(t => `${t.type}:${t.value}`).join('; ');
      csvContent += `${product.id},"${product.name}",${product.price},${product.url},"${tagsStr}"\n`;
    });
    
    fs.writeFileSync('saree_products.csv', csvContent);
    console.log('✅ Data saved to saree_products.csv');
    
    return products;
    
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Function to scrape all tags from product details pages
async function scrapeProductTags(productUrls) {
  const browser = await puppeteer.launch({ headless: true });
  const allTags = new Map();
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    for (let i = 0; i < Math.min(productUrls.length, 5); i++) {
      const productUrl = productUrls[i];
      console.log(`\n🔍 Scraping tags from: ${productUrl}`);
      
      try {
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Extract all tags/attributes from product page
        const tags = await page.evaluate(() => {
          const tagsData = [];
          
          // Look for product meta data
          const metaItems = document.querySelectorAll('.product_meta, .product-meta, .woocommerce-product-attributes');
          
          metaItems.forEach(container => {
            const rows = container.querySelectorAll('tr, .attribute');
            rows.forEach(row => {
              const label = row.querySelector('th, .label, .attribute-label');
              const value = row.querySelector('td, .value, .attribute-value');
              
              if (label && value) {
                tagsData.push({
                  type: label.innerText.trim().replace(':', ''),
                  value: value.innerText.trim()
                });
              }
            });
          });
          
          // Look for specific attribute sections
          const sections = document.querySelectorAll('.product-attributes, .attributes, .details-section');
          sections.forEach(section => {
            const items = section.querySelectorAll('.attribute, .detail-item');
            items.forEach(item => {
              const label = item.querySelector('.att-name, .detail-label');
              const value = item.querySelector('.att-value, .detail-value');
              
              if (label && value) {
                tagsData.push({
                  type: label.innerText.trim(),
                  value: value.innerText.trim()
                });
              }
            });
          });
          
          return tagsData;
        });
        
        console.log(`   Found ${tags.length} tags`);
        tags.forEach(tag => {
          if (!allTags.has(tag.type)) {
            allTags.set(tag.type, new Set());
          }
          allTags.get(tag.type).add(tag.value);
        });
        
      } catch (err) {
        console.log(`   Failed to scrape tags for ${productUrl}:`, err.message);
      }
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('ALL TAGS FROM PRODUCT DETAIL PAGES');
    console.log('='.repeat(80));
    
    for (const [tagType, tagValues] of allTags.entries()) {
      console.log(`\n📌 ${tagType}:`);
      Array.from(tagValues).sort().forEach(value => {
        console.log(`   - ${value}`);
      });
    }
    
  } finally {
    await browser.close();
  }
}

// Main execution
(async () => {
  try {
    const products = await scrapeSareeProducts();
    
    // Optional: Scrape detailed tags from product pages
    if (products.length > 0) {
      const productUrls = products.map(p => p.fullProductUrl.startsWith('/') 
        ? `https://www.lerevecraze.com${p.fullProductUrl}` 
        : p.fullProductUrl);
      
      console.log('\n' + '='.repeat(80));
      console.log('SCRAPING DETAILED TAGS FROM INDIVIDUAL PRODUCT PAGES');
      console.log('='.repeat(80));
      
      await scrapeProductTags(productUrls);
    }
    
  } catch (error) {
    console.error('Scraping failed:', error);
  }
})();