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
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

  const mmToken = await page.evaluate(() => localStorage.getItem('mm_token'));
  if (!mmToken) { console.log('No token'); await browser.close(); return; }

  const API = 'https://d1ekdvyhrdz9i5.cloudfront.net/trpc';
  const headers = { 'Authorization': `Bearer ${mmToken}`, 'Content-Type': 'application/json' };

  async function trpcGet(procedure, input) {
    const url = input
      ? `${API}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${API}/${procedure}`;
    const res = await fetch(url, { headers });
    return { status: res.status, data: await res.text() };
  }

  // 1. Full search response
  console.log('=== SEARCH: Mike Trout ===');
  const search = await trpcGet('public.collectibles.search', {
    query: 'Mike Trout',
    collectibleType: 'sports-card',
    limit: 3,
    offset: 0,
  });
  console.log(`Status: ${search.status}`);
  console.log(search.data.substring(0, 5000));

  // 2. Try search with different params
  console.log('\n=== SEARCH with filters ===');
  const search2 = await trpcGet('public.collectibles.search', {
    query: '2023 Topps Chrome Mike Trout',
    collectibleType: 'sports-card',
    limit: 3,
    offset: 0,
  });
  console.log(`Status: ${search2.status}`);
  console.log(search2.data.substring(0, 5000));

  // 3. Capture card detail page network calls
  console.log('\n\n=== CARD DETAIL PAGE ===');
  const detailCalls = [];
  const detailListener = async (res) => {
    const url = res.url();
    const req = res.request();
    if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
        url.includes('sentry.io') || url.includes('google') || url.includes('launchdarkly') ||
        url.includes('nr-data') || url.includes('.ico') || url.includes('.woff') ||
        url.includes('firebase')) return;
    try {
      const text = await res.text();
      detailCalls.push({
        method: req.method(),
        url,
        status: res.status(),
        body: text.substring(0, 3000),
      });
    } catch (e) {}
  };
  page.on('response', detailListener);

  // Navigate to card detail page
  await page.goto('https://marketmovers.sportscardinvestor.com/sports-card/1116817', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 5000));

  console.log('Page title:', await page.title());
  console.log(`Captured ${detailCalls.length} calls:`);
  for (const call of detailCalls) {
    console.log(`\n${call.method} ${call.url}`);
    console.log(`  Status: ${call.status}`);
    console.log(`  Body: ${call.body.substring(0, 2000)}`);
  }

  // 4. Try direct collectible endpoints
  console.log('\n\n=== DIRECT COLLECTIBLE ENDPOINTS ===');
  const collectibleEndpoints = [
    ['public.collectibles.get', { id: 1116817, collectibleType: 'sports-card' }],
    ['private.collectibles.get', { id: 1116817, collectibleType: 'sports-card' }],
    ['public.collectibles.get', { id: '1116817', collectibleType: 'sports-card' }],
    ['public.collectibles.getDetail', { id: 1116817, collectibleType: 'sports-card' }],
    ['private.collectibles.getDetail', { id: 1116817, collectibleType: 'sports-card' }],
    ['public.collectibles.getDetail', { collectibleId: 1116817, collectibleType: 'sports-card' }],
    ['public.collectibles.getById', { id: 1116817 }],
    ['public.collectibles.view', { id: 1116817, collectibleType: 'sports-card' }],
    ['private.collectibles.view', { id: 1116817, collectibleType: 'sports-card' }],
    // sales data
    ['public.sales.list', { collectibleId: 1116817, collectibleType: 'sports-card', limit: 5 }],
    ['private.sales.list', { collectibleId: 1116817, collectibleType: 'sports-card', limit: 5 }],
    ['public.collectibles.sales', { id: 1116817, collectibleType: 'sports-card', limit: 5 }],
    ['private.collectibles.sales', { id: 1116817, collectibleType: 'sports-card', limit: 5 }],
    ['public.sales.byCollectible', { collectibleId: 1116817, limit: 5 }],
    ['private.sales.byCollectible', { collectibleId: 1116817, limit: 5 }],
    // chart/history
    ['public.collectibles.chartData', { id: 1116817, collectibleType: 'sports-card' }],
    ['private.collectibles.chartData', { id: 1116817, collectibleType: 'sports-card' }],
    ['public.collectibles.priceHistory', { id: 1116817 }],
    ['private.collectibles.priceHistory', { id: 1116817 }],
  ];

  for (const [proc, input] of collectibleEndpoints) {
    const r = await trpcGet(proc, input);
    if (r.status !== 404) {
      console.log(`\n${proc} (${JSON.stringify(input)}): ${r.status}`);
      console.log(`  ${r.data.substring(0, 1500)}`);
    }
  }

  await browser.close();
})().catch(e => console.error(e.message));
