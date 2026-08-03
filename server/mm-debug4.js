const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Capture ALL network requests (not just api/)
  const allRequests = [];
  page.on('response', async (res) => {
    const url = res.url();
    // Skip static assets, fonts, images, analytics
    if (url.includes('.js') || url.includes('.css') || url.includes('.png') ||
        url.includes('.jpg') || url.includes('.svg') || url.includes('.woff') ||
        url.includes('sentry.io') || url.includes('google') || url.includes('launchdarkly') ||
        url.includes('nr-data') || url.includes('firebase') || url.includes('.ico')) return;

    const req = res.request();
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      try {
        const text = await res.text();
        allRequests.push({
          method: req.method(),
          url,
          status: res.status(),
          postData: req.postData()?.substring(0, 500),
          body: text.substring(0, 1000),
        });
      } catch (e) {}
    }
  });

  // Step 1: Login via WordPress
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

  // Get tokens
  const mmToken = await page.evaluate(() => localStorage.getItem('mm_token'));
  const mmRt = await page.evaluate(() => localStorage.getItem('mm_rt'));
  console.log('\nmm_token:', mmToken?.substring(0, 80) + '...');
  console.log('mm_rt:', mmRt?.substring(0, 80) + '...');

  // Decode JWT payload
  if (mmToken) {
    const payload = JSON.parse(Buffer.from(mmToken.split('.')[1], 'base64').toString());
    console.log('\nToken payload:', JSON.stringify(payload, null, 2));
  }

  // Step 2: Navigate to search page and search
  console.log('\n=== Navigating to search ===');
  // Try the search/cards page directly
  await page.goto('https://marketmovers.sportscardinvestor.com/sports-card/search', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  console.log('Search page URL:', page.url());
  await new Promise(r => setTimeout(r, 2000));

  // Find and use search
  const searchInput = await page.$('input[type="search"], input[type="text"], input[placeholder*="search" i]');
  if (searchInput) {
    console.log('Found search, typing "Mike Trout"...');
    await searchInput.click();
    await searchInput.type('Mike Trout', { delay: 50 });
    await new Promise(r => setTimeout(r, 5000)); // Wait for search results
  } else {
    console.log('No search input found on search page');
    // Try dashboard
    await page.goto('https://marketmovers.sportscardinvestor.com/dashboard', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    const dashSearch = await page.$('input[type="search"], input[type="text"], input[placeholder*="search" i]');
    if (dashSearch) {
      console.log('Found search on dashboard, typing "Mike Trout"...');
      await dashSearch.click();
      await dashSearch.type('Mike Trout', { delay: 50 });
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Step 3: Print all captured XHR/fetch requests
  console.log('\n=== All XHR/Fetch calls ===');
  for (const req of allRequests) {
    console.log(`\n${req.method} ${req.url}`);
    console.log(`  Status: ${req.status}`);
    if (req.postData) console.log(`  PostData: ${req.postData.substring(0, 300)}`);
    console.log(`  Response: ${req.body.substring(0, 500)}`);
  }

  await browser.close();
})().catch(e => console.error(e.message));
