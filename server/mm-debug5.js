const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Capture ALL XHR/fetch during page loads
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    const req = res.request();
    if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
    // Skip static/analytics
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
        url.includes('sentry.io') || url.includes('google') || url.includes('launchdarkly') ||
        url.includes('nr-data') || url.includes('.ico') || url.includes('.woff')) return;
    try {
      const text = await res.text();
      apiCalls.push({
        method: req.method(),
        url,
        status: res.status(),
        postData: req.postData()?.substring(0, 500),
        body: text.substring(0, 2000),
        headers: Object.fromEntries(
          Object.entries(req.headers()).filter(([k]) =>
            k === 'authorization' || k === 'content-type' || k === 'x-api-key'
          )
        ),
      });
    } catch (e) {}
  });

  // Step 1: Login
  console.log('=== Logging in ===');
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Logged in, URL:', page.url());

  // Get JWT
  const mmToken = await page.evaluate(() => localStorage.getItem('mm_token'));
  console.log('Got token:', mmToken ? 'yes' : 'no');

  if (!mmToken) {
    console.log('No token found, aborting');
    await browser.close();
    return;
  }

  // Step 2: Capture dashboard API calls (wait for data to load)
  console.log('\n=== Dashboard API calls captured above ===');
  await new Promise(r => setTimeout(r, 5000));

  console.log(`\nCaptured ${apiCalls.length} API calls during dashboard load:`);
  for (const call of apiCalls) {
    console.log(`\n${call.method} ${call.url}`);
    console.log(`  Status: ${call.status}`);
    if (Object.keys(call.headers).length) console.log(`  Headers: ${JSON.stringify(call.headers)}`);
    if (call.postData) console.log(`  PostData: ${call.postData}`);
    console.log(`  Response: ${call.body.substring(0, 800)}`);
  }

  // Step 3: Now use the token directly to probe search/data endpoints
  console.log('\n\n=== Probing API endpoints with token ===');

  const BASE = 'https://marketmovers.sportscardinvestor.com';
  const headers = {
    'Authorization': `Bearer ${mmToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const endpoints = [
    // Search endpoints
    { method: 'GET', path: '/api/search?q=Mike+Trout' },
    { method: 'GET', path: '/api/cards/search?q=Mike+Trout' },
    { method: 'GET', path: '/api/v1/search?q=Mike+Trout' },
    { method: 'GET', path: '/api/v1/cards?q=Mike+Trout' },
    { method: 'GET', path: '/api/sports-card/search?q=Mike+Trout' },
    { method: 'POST', path: '/api/search', body: { query: 'Mike Trout' } },
    { method: 'POST', path: '/api/cards/search', body: { query: 'Mike Trout' } },
    { method: 'POST', path: '/api/v1/search', body: { query: 'Mike Trout' } },
    // Trpc endpoints (Next.js common)
    { method: 'GET', path: '/api/trpc/search?input=' + encodeURIComponent(JSON.stringify({ query: 'Mike Trout' })) },
    { method: 'GET', path: '/api/trpc/card.search?input=' + encodeURIComponent(JSON.stringify({ query: 'Mike Trout' })) },
    // Next.js API routes
    { method: 'GET', path: '/api/card?search=Mike+Trout' },
    { method: 'GET', path: '/api/cards?search=Mike+Trout' },
    { method: 'GET', path: '/api/autocomplete?q=Mike+Trout' },
    // Comps/pricing
    { method: 'GET', path: '/api/comps?q=Mike+Trout' },
    { method: 'GET', path: '/api/pricing?q=Mike+Trout' },
    { method: 'GET', path: '/api/market-data?q=Mike+Trout' },
  ];

  for (const ep of endpoints) {
    try {
      const opts = { method: ep.method, headers };
      if (ep.body) opts.body = JSON.stringify(ep.body);
      const res = await fetch(`${BASE}${ep.path}`, opts);
      const text = await res.text();
      const interesting = res.status !== 404 && res.status !== 405;
      if (interesting) {
        console.log(`\n${ep.method} ${ep.path}: ${res.status}`);
        console.log(`  ${text.substring(0, 500)}`);
      }
    } catch (e) {
      // skip
    }
  }

  // Step 4: Check _next/data routes (Next.js SSR data)
  console.log('\n\n=== Checking Next.js _next/data routes ===');
  // First get the build ID from the page
  const buildId = await page.evaluate(() => {
    return window.__NEXT_DATA__?.buildId;
  });
  console.log('Build ID:', buildId);

  if (buildId) {
    const nextDataPaths = [
      `/sports-card/search.json?q=Mike+Trout`,
      `/dashboard.json`,
    ];
    for (const p of nextDataPaths) {
      try {
        const res = await fetch(`${BASE}/_next/data/${buildId}${p}`, { headers });
        if (res.ok) {
          const text = await res.text();
          console.log(`\n_next/data${p}: ${res.status}`);
          console.log(`  ${text.substring(0, 800)}`);
        }
      } catch (e) {}
    }
  }

  await browser.close();
})().catch(e => console.error(e.message));
