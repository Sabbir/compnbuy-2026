// debug.js
const https = require('https');

const url = 'https://www.thebasketbd.com/rest/V1/search?q=potato&searchCriteria[pageSize]=5';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    console.log('\n--- RAW RESPONSE (first 2000 chars) ---');
    console.log(data.substring(0, 2000));
    
    try {
      const parsed = JSON.parse(data);
      console.log('\n--- PARSED RESPONSE STRUCTURE ---');
      console.log('Top-level keys:', Object.keys(parsed));
      console.log('\nFull parsed response:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch(e) {
      console.log('\n❌ Not valid JSON');
    }
  });
});