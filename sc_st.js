const { scrapeProductSearch } = require('./star_scrapper');

async function scrapeOnePage() {
    const url = 'https://www.startech.com.bd/product/search?&search=mouse';
    const result = await scrapeProductSearch(url);
    console.log(result.products);
}

scrapeOnePage();