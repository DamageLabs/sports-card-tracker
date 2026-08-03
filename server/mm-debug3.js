const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Intercept API/fetch calls after login
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    const isApi = url.includes('/api/') || url.includes('graphql') ||
      url.includes('firestore') || url.includes('identitytoolkit') ||
      url.includes('securetoken');
    if (isApi) {
      try {
        const text = await res.text();
        console.log(`\nRESPONSE ${res.status()} ${res.request().method()} ${url.substring(0, 150)}`);
        console.log(`  ${text.substring(0, 500)}`);
        apiCalls.push({ url, status: res.status(), body: text.substring(0, 1000) });
      } catch (e) {}
    }
  });

  // Step 1: Go to WordPress login
  console.log('=== Logging in via WordPress ===');
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  // Fill in credentials
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');

  console.log('Login submitted, waiting for redirect...');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Current URL:', page.url());
  console.log('Title:', await page.title());

  // Check if login succeeded
  const cookies = await page.cookies();
  const wpCookies = cookies.filter(c => c.name.startsWith('wordpress_logged_in'));
  console.log('WordPress auth cookies:', wpCookies.length > 0 ? 'Present' : 'Missing');

  // Step 2: Navigate to the dashboard
  console.log('\n=== Loading Market Movers dashboard ===');
  await page.goto('https://marketmovers.sportscardinvestor.com/dashboard', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  console.log('Dashboard URL:', page.url());
  console.log('Title:', await page.title());

  // Wait a bit more for async data loading
  await new Promise(r => setTimeout(r, 3000));

  // Check localStorage for auth tokens
  const storage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      items[key] = window.localStorage.getItem(key)?.substring(0, 200);
    }
    return items;
  });
  console.log('\nlocalStorage entries:');
  for (const [k, v] of Object.entries(storage)) {
    console.log(`  ${k}: ${v}`);
  }

  // Step 3: Try searching for a card
  console.log('\n=== Trying search ===');
  const searchInput = await page.$('input[type="search"], input[placeholder*="search" i], input[placeholder*="card" i]');
  if (searchInput) {
    console.log('Found search input');
    await searchInput.type('Mike Trout');
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log('No search input found');
    // List all inputs
    const inputs = await page.$$eval('input', els => els.map(el => ({
      type: el.type,
      placeholder: el.placeholder,
      name: el.name,
      id: el.id,
    })));
    console.log('Available inputs:', JSON.stringify(inputs, null, 2));
  }

  console.log('\n=== All API calls captured ===');
  for (const call of apiCalls) {
    console.log(`\n${call.url.substring(0, 200)}`);
    console.log(`  Status: ${call.status}`);
    console.log(`  Body: ${call.body.substring(0, 300)}`);
  }

  await browser.close();
})().catch(e => console.error(e.message));
