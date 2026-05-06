// debug-fabrilife.js
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Debug script to analyze tags and classes on Fabrilife shop page
 * Website: https://fabrilife.com/shop?query=t-shirt
 */

async function debugFabrilifeSite() {
    console.log('🚀 Starting Fabrilife site debugger...\n');
    
    // Launch browser
    const browser = await puppeteer.launch({
        headless: false, // Set to true for headless mode
        defaultViewport: { width: 1280, height: 720 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Enable request/response logging
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.resourceType() === 'document') {
                console.log(`📄 Loading: ${request.url()}`);
            }
            request.continue();
        });
        
        // Navigate to the page
        console.log('🔍 Navigating to https://fabrilife.com/shop?query=t-shirt...');
        await page.goto('https://fabrilife.com/shop?query=t-shirt', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('✅ Page loaded successfully!\n');
        
        // Wait for content to be fully rendered
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Take screenshot for reference
        await page.screenshot({ path: 'fabrilife-screenshot.png', fullPage: false });
        console.log('📸 Screenshot saved as fabrilife-screenshot.png\n');
        
        // Extract all classes from the page
        const allClasses = await page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            const classes = new Set();
            elements.forEach(el => {
                if (el.className && typeof el.className === 'string') {
                    el.className.split(' ').forEach(cls => {
                        if (cls.trim()) classes.add(cls.trim());
                    });
                } else if (el.className && el.className.baseVal) {
                    // For SVG elements
                    classes.add(el.className.baseVal);
                }
            });
            return Array.from(classes).sort();
        });
        
        console.log('📋 === ALL CSS CLASSES FOUND ===');
        console.log(`Total unique classes: ${allClasses.length}\n`);
        console.log(allClasses.slice(0, 50).join(', '));
        if (allClasses.length > 50) {
            console.log(`... and ${allClasses.length - 50} more classes`);
        }
        console.log('\n');
        
        // Save all classes to file
        fs.writeFileSync('all-classes.json', JSON.stringify(allClasses, null, 2));
        console.log('💾 All classes saved to all-classes.json\n');
        
        // Analyze product-related elements
        console.log('🛍️ === PRODUCT STRUCTURE ANALYSIS ===\n');
        
        const productAnalysis = await page.evaluate(() => {
            const results = {
                productContainers: [],
                productTitles: [],
                productPrices: [],
                productImages: [],
                productLinks: [],
                addToCartButtons: [],
                filters: [],
                pagination: []
            };
            
            // Helper function to check if element contains text
            const containsText = (element, text) => {
                return element.textContent.toLowerCase().includes(text.toLowerCase());
            };
            
            // Look for common product container patterns
            const selectors = [
                '.product-item', '.product-card', '.product', '.item',
                '.product-wrapper', '.product-container', '[data-product-id]',
                '.product-box', '.shop-item', '.product-grid-item', '.collection-product',
                '.product-block', '.product-tile', '.product-list-item'
            ];
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    results.productContainers.push({
                        selector: selector,
                        className: elements[0].className,
                        tagName: elements[0].tagName,
                        count: elements.length
                    });
                }
            });
            
            // Find elements that might contain product titles
            const titleSelectors = ['.product-title', '.product-name', '.title', 'h3', 'h4', '.item-title', '.product__title', '.card-title', '.product-heading'];
            titleSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const text = el.textContent.trim();
                    if (text && text.length > 0 && text.length < 200) {
                        results.productTitles.push({
                            selector: selector,
                            className: el.className,
                            text: text.substring(0, 50),
                            tagName: el.tagName
                        });
                    }
                });
            });
            
            // Find price elements
            const priceSelectors = ['.price', '.product-price', '.amount', '.current-price', '.sale-price', '[data-price]', '.price-amount', '.product-price-amount'];
            priceSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const text = el.textContent.trim();
                    if (text && (text.includes('৳') || text.includes('TK') || /[\d]+/.test(text))) {
                        results.productPrices.push({
                            selector: selector,
                            className: el.className,
                            text: text,
                            tagName: el.tagName
                        });
                    }
                });
            });
            
            // Find images within product context
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                // Check if image is likely a product image
                const isProductImage = img.closest('.product, .item, .product-card, .product-item, .collection-product, .product-tile') ||
                                      img.alt?.toLowerCase().includes('product') ||
                                      img.className?.toLowerCase().includes('product');
                
                if (isProductImage) {
                    results.productImages.push({
                        src: img.src,
                        alt: img.alt,
                        className: img.className,
                        parentClass: img.parentElement?.className,
                        width: img.width,
                        height: img.height
                    });
                }
            });
            
            // Find product links
            const links = document.querySelectorAll('a[href*="/product"], a[href*="/shop/"], a[href*="/item"], a[href*="/p/"]');
            links.forEach(link => {
                if (link.href && !link.href.includes('javascript:')) {
                    results.productLinks.push({
                        href: link.href,
                        className: link.className,
                        text: link.textContent?.trim().substring(0, 30)
                    });
                }
            });
            
            // Find add to cart buttons
            const allButtons = document.querySelectorAll('button, input[type="submit"], .btn, [role="button"]');
            allButtons.forEach(btn => {
                const btnText = btn.textContent?.toLowerCase() || btn.value?.toLowerCase() || '';
                if (btnText.includes('add') || btnText.includes('cart') || btnText.includes('buy') ||
                    btn.className?.toLowerCase().includes('add-to-cart') ||
                    btn.className?.toLowerCase().includes('addtocart')) {
                    results.addToCartButtons.push({
                        className: btn.className,
                        text: btn.textContent?.trim() || btn.value,
                        tagName: btn.tagName
                    });
                }
            });
            
            // Find filter elements
            const filters = document.querySelectorAll('.filter, .filters, .sidebar, [data-filter], select, .filter-option, .filter-group, .filter-section');
            results.filters = Array.from(filters).slice(0, 20).map(f => ({
                className: f.className,
                tagName: f.tagName,
                type: f.type || f.getAttribute('role') || 'N/A'
            }));
            
            // Find pagination
            const paginationSelectors = ['.pagination', '.pager', '.load-more', '[data-pagination]', '.pages', '.page-numbers'];
            paginationSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    results.pagination.push({
                        className: el.className,
                        tagName: el.tagName
                    });
                });
            });
            
            return results;
        });
        
        // Display product analysis
        console.log('🏷️  Product Containers Found:');
        if (productAnalysis.productContainers.length > 0) {
            const uniqueContainers = [...new Map(productAnalysis.productContainers.map(item => 
                [item.selector, item]
            )).values()];
            uniqueContainers.forEach(container => {
                console.log(`  • ${container.selector} - Class: "${container.className}" (${container.count} found)`);
            });
        } else {
            console.log('  ⚠️ No standard product containers detected');
            console.log('  💡 Looking for alternative structure...');
            
            // Try to identify products by common patterns
            const possibleProducts = await page.evaluate(() => {
                const items = [];
                // Look for elements with images and prices
                const elements = document.querySelectorAll('div, li, article, .col, .row > div');
                elements.forEach(el => {
                    const hasImage = el.querySelector('img');
                    const hasPrice = el.querySelector('[class*="price"], [class*="Price"], [class*="amount"]');
                    const hasTitle = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="Title"], [class*="name"]');
                    if (hasImage && (hasPrice || hasTitle)) {
                        const id = el.id;
                        const className = el.className;
                        if (className && className !== '') {
                            items.push({
                                className: className,
                                tagName: el.tagName,
                                id: id || 'no-id'
                            });
                        }
                    }
                });
                return items.slice(0, 10);
            });
            
            if (possibleProducts.length > 0) {
                console.log('  🎯 Possible product containers detected:');
                possibleProducts.forEach((p, idx) => {
                    console.log(`    ${idx + 1}. Tag: ${p.tagName}, Class: "${p.className}", ID: "${p.id}"`);
                });
            } else {
                console.log('  ❌ Could not auto-detect product containers');
            }
        }
        
        console.log('\n📝 Product Titles Examples:');
        if (productAnalysis.productTitles.length > 0) {
            productAnalysis.productTitles.slice(0, 5).forEach(title => {
                console.log(`  • "${title.text}"`);
                console.log(`    → ${title.tagName}.${title.className} (selector: ${title.selector})`);
            });
        } else {
            console.log('  ❌ No product titles found');
        }
        
        console.log('\n💰 Price Elements Examples:');
        if (productAnalysis.productPrices.length > 0) {
            productAnalysis.productPrices.slice(0, 5).forEach(price => {
                console.log(`  • "${price.text}"`);
                console.log(`    → ${price.tagName}.${price.className} (selector: ${price.selector})`);
            });
        } else {
            console.log('  ❌ No price elements found');
        }
        
        console.log(`\n📸 Product Images Found: ${productAnalysis.productImages.length}`);
        console.log(`🔗 Product Links Found: ${productAnalysis.productLinks.length}`);
        console.log(`🛒 Add to Cart Buttons: ${productAnalysis.addToCartButtons.length}`);
        console.log(`🔍 Filter Elements: ${productAnalysis.filters.length}`);
        console.log(`📄 Pagination Elements: ${productAnalysis.pagination.length}`);
        
        // Get page structure information
        const pageStructure = await page.evaluate(() => {
            return {
                totalElements: document.querySelectorAll('*').length,
                totalDivs: document.querySelectorAll('div').length,
                totalSpans: document.querySelectorAll('span').length,
                totalButtons: document.querySelectorAll('button').length,
                totalForms: document.querySelectorAll('form').length,
                totalInputs: document.querySelectorAll('input, select, textarea').length,
                totalLinks: document.querySelectorAll('a').length,
                totalImages: document.querySelectorAll('img').length,
                hasReact: !!window.React || !!document.querySelector('[data-reactroot], [data-reactid]'),
                hasVue: !!window.Vue || !!document.querySelector('[data-v-]'),
                hasjQuery: !!window.jQuery,
                bodyClasses: document.body.className,
                mainContentSelectors: ['main', '#main', '.main-content', '.content', '#content', '.container', '.wrapper'].map(sel => ({
                    selector: sel,
                    exists: !!document.querySelector(sel),
                    className: document.querySelector(sel)?.className || null
                }))
            };
        });
        
        console.log('\n🌐 === PAGE STRUCTURE INFO ===');
        console.log(`Total Elements: ${pageStructure.totalElements.toLocaleString()}`);
        console.log(`Divs: ${pageStructure.totalDivs.toLocaleString()}`);
        console.log(`Spans: ${pageStructure.totalSpans.toLocaleString()}`);
        console.log(`Buttons: ${pageStructure.totalButtons.toLocaleString()}`);
        console.log(`Links: ${pageStructure.totalLinks.toLocaleString()}`);
        console.log(`Images: ${pageStructure.totalImages.toLocaleString()}`);
        console.log(`Forms: ${pageStructure.totalForms}`);
        console.log(`Inputs: ${pageStructure.totalInputs}`);
        console.log(`Body Class: "${pageStructure.bodyClasses}"`);
        console.log(`React Detected: ${pageStructure.hasReact ? 'Yes ✅' : 'No ❌'}`);
        console.log(`Vue Detected: ${pageStructure.hasVue ? 'Yes ✅' : 'No ❌'}`);
        console.log(`jQuery Detected: ${pageStructure.hasjQuery ? 'Yes ✅' : 'No ❌'}`);
        
        console.log('\nMain Content Selectors:');
        pageStructure.mainContentSelectors.forEach(sel => {
            const status = sel.exists ? `✅ Found (class: "${sel.className}")` : '❌ Not found';
            console.log(`  • ${sel.selector}: ${status}`);
        });
        
        // Extract all data attributes
        const dataAttributes = await page.evaluate(() => {
            const elements = document.querySelectorAll('[data-*]');
            const attributes = new Set();
            elements.forEach(el => {
                Array.from(el.attributes).forEach(attr => {
                    if (attr.name.startsWith('data-')) {
                        attributes.add(attr.name);
                    }
                });
            });
            return Array.from(attributes).sort();
        });
        
        console.log(`\n🏷️  Data Attributes Found: ${dataAttributes.length}`);
        if (dataAttributes.length > 0) {
            console.log('Sample data attributes:', dataAttributes.slice(0, 20).join(', '));
            if (dataAttributes.length > 20) {
                console.log(`... and ${dataAttributes.length - 20} more`);
            }
        }
        
        // Get specific information about product grid/list
        const productGridInfo = await page.evaluate(() => {
            // Try to find the main product listing container
            const possibleGrids = document.querySelectorAll('.products, .product-grid, .product-list, .shop-products, .collection-products, [class*="product"], [class*="Product"]');
            let gridContainer = null;
            
            for (let grid of possibleGrids) {
                if (grid.querySelectorAll('img').length > 2 && grid.querySelectorAll('[class*="price"]').length > 0) {
                    gridContainer = {
                        className: grid.className,
                        id: grid.id,
                        tagName: grid.tagName,
                        childCount: grid.children.length,
                        productCount: grid.querySelectorAll('[class*="product"], [class*="item"]').length || grid.children.length
                    };
                    break;
                }
            }
            
            return gridContainer;
        });
        
        if (productGridInfo) {
            console.log('\n📦 === PRODUCT GRID/LIST CONTAINER ===');
            console.log(`Container: ${productGridInfo.tagName}#${productGridInfo.id || 'no-id'}.${productGridInfo.className}`);
            console.log(`Child elements: ${productGridInfo.childCount}`);
            console.log(`Estimated products: ${productGridInfo.productCount}`);
        }
        
        // Save detailed analysis to file
        const debugData = {
            timestamp: new Date().toISOString(),
            url: 'https://fabrilife.com/shop?query=t-shirt',
            totalClasses: allClasses.length,
            classesSample: allClasses.slice(0, 200),
            productAnalysis: productAnalysis,
            pageStructure: pageStructure,
            dataAttributes: dataAttributes,
            productGridInfo: productGridInfo
        };
        
        fs.writeFileSync('fabrilife-debug-data.json', JSON.stringify(debugData, null, 2));
        console.log('\n💾 Full debug data saved to fabrilife-debug-data.json');
        
        // Generate CSS selectors for common elements
        const cssSelectors = {
            productCard: productAnalysis.productContainers[0]?.selector || productAnalysis.productTitles[0]?.selector?.replace(/h3|h4/, '.product-card') || '.product-item',
            productTitle: productAnalysis.productTitles[0]?.selector || 'h3, h4, .product-title',
            productPrice: productAnalysis.productPrices[0]?.selector || '.price, .product-price',
            productImage: 'img',
            addToCart: '.add-to-cart, button:contains("Add")',
            filters: '.filter, .filters select',
            pagination: '.pagination a'
        };
        
        // Generate a summary report
        const report = `=== FABRILIFE DEBUG REPORT ===
Generated: ${new Date().toLocaleString()}

URL: https://fabrilife.com/shop?query=t-shirt

📊 SUMMARY:
- Total CSS Classes Found: ${allClasses.length}
- Total Elements: ${pageStructure.totalElements.toLocaleString()}
- Product-like containers found: ${productAnalysis.productContainers.length || 'Auto-detected'}
- Product titles found: ${productAnalysis.productTitles.length}
- Price elements found: ${productAnalysis.productPrices.length}
- Product images found: ${productAnalysis.productImages.length}
- Product links found: ${productAnalysis.productLinks.length}
- Add to cart buttons: ${productAnalysis.addToCartButtons.length}

🔧 TECHNOLOGY STACK:
- React: ${pageStructure.hasReact ? '✓' : '✗'}
- Vue: ${pageStructure.hasVue ? '✓' : '✗'}
- jQuery: ${pageStructure.hasjQuery ? '✓' : '✗'}

🎯 SUGGESTED CSS SELECTORS FOR SCRAPING:
- Product Card: ${cssSelectors.productCard}
- Product Title: ${cssSelectors.productTitle}
- Product Price: ${cssSelectors.productPrice}
- Product Image: ${cssSelectors.productImage}
- Add to Cart Button: ${cssSelectors.addToCart}
- Filter Elements: ${cssSelectors.filters}
- Pagination: ${cssSelectors.pagination}

📁 FILES GENERATED:
1. fabrilife-screenshot.png - Page screenshot
2. all-classes.json - Complete list of all CSS classes
3. fabrilife-debug-data.json - Full debug information

💡 RECOMMENDATIONS:
${!productAnalysis.productContainers.length ? '- Inspect the page manually to identify product container classes\n' : ''}
${!productAnalysis.productTitles.length ? '- Look for product titles in heading tags or elements with title/name classes\n' : ''}
${!productAnalysis.productPrices.length ? '- Check for price elements with currency symbols (৳, TK) or price-specific classes\n' : ''}
${pageStructure.hasReact ? '- Site uses React, elements might be dynamically rendered\n' : ''}
${pageStructure.hasVue ? '- Site uses Vue.js, look for data-v- attributes\n' : ''}
- Consider using page.waitForSelector() for dynamic content
- Use page.evaluate() to extract data from identified selectors
`;
        
        fs.writeFileSync('fabrilife-debug-report.txt', report);
        console.log('📄 Debug report saved to fabrilife-debug-report.txt');
        
        console.log('\n✨ Debugging complete! Check the generated files for detailed analysis.');
        console.log('\n📋 Quick Reference - Suggested CSS Selectors:');
        console.log(`  • Product Card: ${cssSelectors.productCard}`);
        console.log(`  • Product Title: ${cssSelectors.productTitle}`);
        console.log(`  • Product Price: ${cssSelectors.productPrice}`);
        
        // Keep browser open for 10 seconds to view results
        console.log('\n⏱️  Browser will close in 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
    } catch (error) {
        console.error('❌ Error during debugging:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await browser.close();
        console.log('🔒 Browser closed');
    }
}

// Run the debugger
debugFabrilifeSite().catch(console.error);