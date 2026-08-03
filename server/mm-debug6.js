const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Login
  console.log('=== Logging in ===');
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

  const mmToken = await page.evaluate(() => localStorage.getItem('mm_token'));
  if (!mmToken) { console.log('No token'); await browser.close(); return; }
  console.log('Got token');

  const API = 'https://d1ekdvyhrdz9i5.cloudfront.net/trpc';
  const headers = {
    'Authorization': `Bearer ${mmToken}`,
    'Content-Type': 'application/json',
  };

  async function trpcGet(procedure, input) {
    const url = input
      ? `${API}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${API}/${procedure}`;
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      return { status: res.status, data: text.substring(0, 2000) };
    } catch (e) {
      return { status: 'error', data: e.message };
    }
  }

  // 1. Get card details for known collection IDs
  console.log('\n=== Card Details ===');
  const cardEndpoints = [
    ['private.collectibles.get', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectibles.get', { id: '1116817', collectibleType: 'sports-card' }],
    ['private.collectible.get', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectible.get', { id: '1116817', collectibleType: 'sports-card' }],
    ['private.collectibles.getById', { id: '1116817' }],
    ['public.collectibles.getById', { id: '1116817' }],
    ['private.cards.get', { id: '1116817' }],
    ['public.cards.get', { id: '1116817' }],
    ['private.collectibles.detail', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectibles.detail', { id: '1116817', collectibleType: 'sports-card' }],
  ];

  for (const [proc, input] of cardEndpoints) {
    const r = await trpcGet(proc, input);
    if (r.status !== 404 && r.status !== 'error') {
      console.log(`\n${proc}: ${r.status}`);
      console.log(`  ${r.data.substring(0, 800)}`);
    }
  }

  // 2. Search endpoints
  console.log('\n=== Search ===');
  const searchEndpoints = [
    ['private.search', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['public.search', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['private.collectibles.search', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['public.collectibles.search', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['private.search.collectibles', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['public.search.collectibles', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['private.search.query', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['private.search.autocomplete', { query: 'Mike Trout' }],
    ['public.search.autocomplete', { query: 'Mike Trout' }],
    ['private.autocomplete', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['public.autocomplete', { query: 'Mike Trout', collectibleType: 'sports-card' }],
    ['private.collectibles.list', { filters: { query: 'Mike Trout', collectibleType: 'sports-card' }, limit: 5 }],
    ['public.collectibles.list', { filters: { query: 'Mike Trout', collectibleType: 'sports-card' }, limit: 5 }],
    ['private.collectibles.list', { filters: { search: 'Mike Trout', collectibleType: 'sports-card' }, limit: 5 }],
    ['private.players.search', { query: 'Mike Trout' }],
    ['public.players.search', { query: 'Mike Trout' }],
  ];

  for (const [proc, input] of searchEndpoints) {
    const r = await trpcGet(proc, input);
    if (r.status !== 404 && r.status !== 'error') {
      console.log(`\n${proc}: ${r.status}`);
      console.log(`  ${r.data.substring(0, 1000)}`);
    }
  }

  // 3. Sales/pricing endpoints
  console.log('\n=== Sales/Pricing ===');
  const salesEndpoints = [
    ['private.sales.list', { collectibleId: '1116817', collectibleType: 'sports-card' }],
    ['public.sales.list', { collectibleId: '1116817', collectibleType: 'sports-card' }],
    ['private.collectibles.sales', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectibles.sales', { id: '1116817', collectibleType: 'sports-card' }],
    ['private.sales.getByCollectible', { collectibleId: '1116817' }],
    ['private.collectibles.pricing', { id: '1116817', collectibleType: 'sports-card' }],
    ['private.collectibles.marketData', { id: '1116817' }],
    ['private.pricing.get', { collectibleId: '1116817' }],
    ['public.pricing.get', { collectibleId: '1116817' }],
    ['private.collectibles.chart', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectibles.chart', { id: '1116817', collectibleType: 'sports-card' }],
  ];

  for (const [proc, input] of salesEndpoints) {
    const r = await trpcGet(proc, input);
    if (r.status !== 404 && r.status !== 'error') {
      console.log(`\n${proc}: ${r.status}`);
      console.log(`  ${r.data.substring(0, 1500)}`);
    }
  }

  // 4. Intercept search page network calls
  console.log('\n\n=== Intercepting search page ===');
  const searchCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    const req = res.request();
    if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') &&
        url.includes('cloudfront') && !url.includes('.js')) {
      try {
        const text = await res.text();
        searchCalls.push({ url, status: res.status(), body: text.substring(0, 2000) });
      } catch (e) {}
    }
  });

  // Navigate to a specific card page to see what API it calls
  await page.goto('https://marketmovers.sportscardinvestor.com/sports-card/1116817', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 3000));

  console.log('Card page URL:', page.url());
  for (const call of searchCalls) {
    console.log(`\n${call.url.substring(0, 200)}`);
    console.log(`  Status: ${call.status}`);
    console.log(`  Body: ${call.body.substring(0, 1500)}`);
  }

  await browser.close();
})().catch(e => console.error(e.message));
