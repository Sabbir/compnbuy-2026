async function debugChaldalStructure() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://chaldal.com/search/milk', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(5000);
    
    // Debug: Log all elements on page
    const structure = await page.evaluate(() => {
        // Find all elements that might contain products
        const allDivs = document.querySelectorAll('div');
        const potentialContainers = [];
        
        allDivs.forEach(div => {
            if (div.children.length > 2 && div.innerText.includes('TK')) {
                potentialContainers.push({
                    className: div.className,
                    id: div.id,
                    childCount: div.children.length,
                    textSample: div.innerText.substring(0, 100)
                });
            }
        });
        
        // Check for React/Vue data attributes
        const reactProps = [];
        document.querySelectorAll('[data-reactroot], [data-reactid], [data-v-]').forEach(el => {
            reactProps.push({
                tag: el.tagName,
                attributes: Array.from(el.attributes).map(attr => `${attr.name}=${attr.value}`)
            });
        });
        
        // Check window object for data
        const windowData = {};
        if (window.__INITIAL_STATE__) windowData.__INITIAL_STATE__ = true;
        if (window.__DATA__) windowData.__DATA__ = true;
        if (window.__NUXT__) windowData.__NUXT__ = true;
        if (window.__REDUX_STATE__) windowData.__REDUX_STATE__ = true;
        
        return { potentialContainers, reactProps, windowData };
    });
    
    console.log('Potential product containers:', structure.potentialContainers);
    console.log('React/Vue attributes:', structure.reactProps);
    console.log('Window data available:', structure.windowData);
    
    await browser.close();
}

debugChaldalStructure();