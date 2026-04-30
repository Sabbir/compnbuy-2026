const puppeteer = require('puppeteer');

async function debugAvailableTags() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();
  
  // Monitor all network requests
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/catalogsearch/result/') || request.url().includes('/graphql')) {
      console.log('Search/API request:', request.url());
    }
    request.continue();
  });
  
  console.log('Navigating to the page...');
  await page.goto('https://www.thebasketbd.com/catalogsearch/result/?q=potato', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  
  // Wait for page to fully settle
  await new Promise(r => setTimeout(r, 3000));
  
  // Debug what's actually on the page (FIXED VERSION)
  const debug = await page.evaluate(() => {
    // Helper function to safely get class names
    const getClassNames = (element) => {
      if (!element) return '';
      if (typeof element.className === 'string') return element.className;
      if (element.className && element.className.baseVal) return element.className.baseVal;
      return '';
    };
    
    // Check for "No Result" message
    const bodyText = document.body?.innerText || '';
    const hasNoResult = bodyText.includes('No Result') || bodyText.includes('No result');
    
    // Get main content area
    const mainSelectors = ['main', '.main', '#maincontent', '.page-main', '.columns'];
    let mainContent = '';
    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element && element.innerText) {
        mainContent = element.innerText.substring(0, 1000);
        break;
      }
    }
    
    // Look for any price indicators
    const hasPriceSymbol = bodyText.includes('TK') || 
                          bodyText.includes('৳') || 
                          bodyText.includes('BDT') ||
                          bodyText.includes('Tk.');
    
    // Find elements that might be products (FIXED: safe className handling)
    const allElements = document.querySelectorAll('div, li, article, section');
    const potentialProductContainers = [];
    
    allElements.forEach(el => {
      const classes = getClassNames(el);
      const hasProductClass = classes.toLowerCase().includes('product') || 
                              classes.toLowerCase().includes('item') ||
                              classes.toLowerCase().includes('card');
      
      const innerText = el.innerText || '';
      const hasPrice = innerText.includes('TK') || innerText.includes('৳');
      
      if (hasProductClass || hasPrice) {
        // Safely get element info
        const elementInfo = {
          tagName: el.tagName,
          className: classes.substring(0, 100),
          id: el.id || '',
          textSample: innerText.substring(0, 150),
          hasPrice: hasPrice
        };
        
        if (potentialProductContainers.length < 20) { // Limit to 20 samples
          potentialProductContainers.push(elementInfo);
        }
      }
    });
    
    // Check pagination
    const paginationSelectors = ['.pages', '.pagination', '.toolbar', '.pager'];
    let paginationText = '';
    for (const selector of paginationSelectors) {
      const element = document.querySelector(selector);
      if (element && element.innerText) {
        paginationText = element.innerText.substring(0, 300);
        break;
      }
    }
    
    // Look for data attributes (FIXED: safe iteration)
    const dataAttrs = [];
    const allElementsWithData = document.querySelectorAll('[data-product], [data-sku], [data-id], [data-entity-id]');
    allElementsWithData.forEach(el => {
      const attrs = {
        tag: el.tagName,
        'data-product': el.getAttribute('data-product'),
        'data-sku': el.getAttribute('data-sku'),
        'data-id': el.getAttribute('data-id')
      };
      dataAttrs.push(attrs);
    });
    
    // Check for JSON-LD / structured data
    const jsonLdScripts = [];
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const content = script.innerHTML;
        if (content && content.length < 1000) {
          jsonLdScripts.push(JSON.parse(content));
        }
      } catch (e) {
        jsonLdScripts.push({ error: 'Invalid JSON' });
      }
    });
    
    return {
      hasNoResultMessage: hasNoResult,
      hasPriceSymbol: hasPriceSymbol,
      mainContentSnippet: mainContent,
      potentialProductContainers: potentialProductContainers,
      potentialProductCount: potentialProductContainers.length,
      paginationText: paginationText,
      pageTitle: document.title || '',
      url: window.location.href,
      dataAttributesFound: dataAttrs.length,
      jsonLdScriptsCount: jsonLdScripts.length,
      jsonLdContent: jsonLdScripts.slice(0, 2) // First 2 scripts
    };
  });
  
  console.log('\n=== DEBUG RESULTS ===\n');
  console.log('Page Title:', debug.pageTitle);
  console.log('URL:', debug.url);
  console.log('Has "No Result" message:', debug.hasNoResultMessage);
  console.log('Has price symbols (TK/৳):', debug.hasPriceSymbol);
  console.log('Potential product containers found:', debug.potentialProductCount);
  console.log('Data attributes found:', debug.dataAttributesFound);
  console.log('JSON-LD scripts found:', debug.jsonLdScriptsCount);
  
  if (debug.potentialProductContainers.length > 0) {
    console.log('\n=== SAMPLE POTENTIAL PRODUCTS ===');
    debug.potentialProductContainers.slice(0, 5).forEach((container, i) => {
      console.log(`\nContainer ${i + 1}:`);
      console.log(`  Tag: ${container.tagName}`);
      console.log(`  Class: ${container.className}`);
      console.log(`  ID: ${container.id || 'none'}`);
      console.log(`  Text: ${container.textSample}`);
      console.log(`  Has price: ${container.hasPrice}`);
    });
  } else {
    console.log('\n⚠️ No product containers found');
  }
  
  if (debug.jsonLdContent.length > 0) {
    console.log('\n=== STRUCTURED DATA (JSON-LD) ===');
    console.log(JSON.stringify(debug.jsonLdContent, null, 2));
  }
  
  console.log('\n=== MAIN CONTENT SNIPPET ===');
  console.log(debug.mainContentSnippet);
  
  if (debug.paginationText) {
    console.log('\n=== PAGINATION INFO ===');
    console.log(debug.paginationText);
  }
  
  // Take screenshot
  await page.screenshot({ path: 'thebasketbd-debug.png', fullPage: true });
  console.log('\n✅ Screenshot saved as: thebasketbd-debug.png');
  
  // Save HTML for analysis
  const fs = require('fs');
  const html = await page.content();
  fs.writeFileSync('thebasketbd-page.html', html);
  console.log('✅ HTML saved as: thebasketbd-page.html');
  
  await browser.close();
  
  // Recommendations based on findings
  console.log('\n=== RECOMMENDATIONS ===');
  if (debug.hasNoResultMessage) {
    console.log('❌ No products found for "potato" search');
    console.log('📝 Try these alternative searches:');
    console.log('   - onion');
    console.log('   - rice');
    console.log('   - vegetable');
    console.log('   - oil');
    console.log('   - fish');
  } else if (debug.potentialProductCount === 0 && !debug.hasPriceSymbol) {
    console.log('⚠️ The page has no product data. The site might be:');
    console.log('   - Blocking headless browsers');
    console.log('   - Using client-side rendering that failed');
    console.log('   - Temporarily down or misconfigured');
  } else if (debug.potentialProductCount > 0) {
    console.log('✅ Products exist on the page!');
    console.log('🔧 Update selectors in scraping script to match the class names above');
  }
}

// Run the debug function
debugAvailableTags().catch(console.error);