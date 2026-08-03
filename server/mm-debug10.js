const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Capture ALL fetch/xhr
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    const req = res.request();
    if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
    if (url.includes('.js') || url.includes('.css') || url.includes('sentry') ||
        url.includes('google') || url.includes('launchdarkly') ||
        url.includes('nr-data') || url.includes('firebase') || url.includes('.woff') ||
        url.includes('.ico') || url.includes('.png')) return;
    try {
      const text = await res.text();
      apiCalls.push({
        method: req.method(),
        url: decodeURIComponent(url),
        status: res.status(),
        body: text.substring(0, 5000),
      });
    } catch (e) {}
  });

  // Login
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  const mmToken = await page.evaluate(() => localStorage.getItem('mm_token'));
  console.log('Logged in, got token:', !!mmToken);

  // Wait for dashboard load
  await new Promise(r => setTimeout(r, 3000));
  apiCalls.length = 0; // Clear dashboard load calls

  // 1. Use the unified search input
  console.log('\n=== UNIFIED SEARCH ===');
  const searchInput = await page.$('#unified-search-input');
  if (searchInput) {
    await searchInput.click();
    await searchInput.type('Mike Trout', { delay: 80 });
    await new Promise(r => setTimeout(r, 5000)); // Wait for autocomplete/suggestions

    console.log(`Captured ${apiCalls.length} API calls after search:`);
    for (const call of apiCalls) {
      if (!call.url.includes('private.user')) {
        console.log(`\n${call.method} ${call.url.substring(0, 300)}`);
        console.log(`  Status: ${call.status}`);
        console.log(`  Body: ${call.body.substring(0, 3000)}`);
      }
    }

    // Check for search results in the DOM
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="result"], [class*="suggestion"], [class*="option"], [class*="item"], .ant-select-item');
      return Array.from(items).slice(0, 10).map(el => ({
        text: el.textContent?.trim().substring(0, 100),
        class: el.className?.toString().substring(0, 80),
      }));
    });
    console.log('\nSearch result elements:', JSON.stringify(results.slice(0, 5), null, 2));
  } else {
    console.log('No #unified-search-input found');
  }

  // 2. Try the sales-history / comps search page
  console.log('\n\n=== SALES HISTORY / COMPS SEARCH ===');
  apiCalls.length = 0;

  await page.goto('https://marketmovers.sportscardinvestor.com/sales-history?search=Mike+Trout', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 5000));

  console.log('Page URL:', page.url());
  console.log(`Captured ${apiCalls.length} API calls:`);
  for (const call of apiCalls) {
    if (!call.url.includes('private.user') && !call.url.includes('settings') &&
        !call.url.includes('infoBanners') && !call.url.includes('exchangeRates')) {
      console.log(`\n${call.method} ${call.url.substring(0, 400)}`);
      console.log(`  Status: ${call.status}`);
      console.log(`  Body: ${call.body.substring(0, 3000)}`);
    }
  }

  // 3. Also try direct API for sales-history
  console.log('\n\n=== DIRECT API: Sales History ===');
  const API = 'https://d1ekdvyhrdz9i5.cloudfront.net/trpc';
  const headers = { 'Authorization': `Bearer ${mmToken}`, 'Content-Type': 'application/json' };

  const salesEndpoints = [
    ['public.salesHistory.search', { query: 'Mike Trout', limit: 3 }],
    ['private.salesHistory.search', { query: 'Mike Trout', limit: 3 }],
    ['public.sales.search', { query: 'Mike Trout', limit: 3 }],
    ['private.sales.search', { query: 'Mike Trout', limit: 3 }],
    ['public.comps.search', { query: 'Mike Trout', limit: 3 }],
    ['private.comps.search', { query: 'Mike Trout', limit: 3 }],
    ['public.salesHistory.list', { query: 'Mike Trout', limit: 3 }],
    ['private.salesHistory.list', { query: 'Mike Trout', limit: 3 }],
    ['public.sales.history', { query: 'Mike Trout', limit: 3 }],
    ['private.sales.history', { query: 'Mike Trout', limit: 3 }],
  ];

  for (const [proc, input] of salesEndpoints) {
    const url = `${API}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
    try {
      const res = await fetch(url, { headers });
      if (res.status !== 404) {
        const text = await res.text();
        console.log(`\n${proc}: ${res.status}`);
        console.log(`  ${text.substring(0, 1500)}`);
      }
    } catch (e) {}
  }

  await browser.close();
})().catch(e => console.error(e.message));
