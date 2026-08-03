const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Intercept all API/XHR requests
  const apiCalls = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('api') || url.includes('graphql') || req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      apiCalls.push({
        method: req.method(),
        url: url,
        headers: req.headers(),
        postData: req.postData()?.substring(0, 500),
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if ((url.includes('api') || url.includes('graphql')) && !url.includes('googleapis.com/css')) {
      try {
        const text = await res.text();
        console.log(`RESPONSE ${res.status()} ${url.substring(0, 120)}`);
        console.log(`  ${text.substring(0, 300)}`);
      } catch (e) {}
    }
  });

  console.log('=== Loading dashboard ===');
  await page.goto('https://marketmovers.sportscardinvestor.com/dashboard', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  console.log('\nPage URL:', page.url());
  console.log('Title:', await page.title());

  // Check if we're on a login page
  const html = await page.content();
  const hasLoginForm = html.includes('password') || html.includes('sign in') || html.includes('log in');
  console.log('Has login form:', hasLoginForm);

  // Look for login form fields
  const inputs = await page.$$eval('input', els => els.map(el => ({
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
  })));
  console.log('\nInput fields:', JSON.stringify(inputs, null, 2));

  // Look for buttons
  const buttons = await page.$$eval('button, a[href*="login"], a[href*="signin"]', els => els.map(el => ({
    tag: el.tagName,
    text: el.textContent?.trim().substring(0, 50),
    href: el.href || '',
    type: el.type || '',
  })));
  console.log('\nButtons:', JSON.stringify(buttons.slice(0, 10), null, 2));

  // Check for Firebase/Auth0/Cognito scripts
  const scripts = await page.$$eval('script[src]', els => els.map(el => el.src));
  const authScripts = scripts.filter(s =>
    s.includes('firebase') || s.includes('auth0') || s.includes('cognito') ||
    s.includes('supabase') || s.includes('clerk')
  );
  console.log('\nAuth-related scripts:', authScripts);

  // Check localStorage and cookies for auth hints
  const localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      items[key] = window.localStorage.getItem(key)?.substring(0, 100);
    }
    return items;
  });
  console.log('\nlocalStorage keys:', Object.keys(localStorage));
  for (const [k, v] of Object.entries(localStorage)) {
    if (k.includes('auth') || k.includes('token') || k.includes('session') || k.includes('user')) {
      console.log(`  ${k}: ${v}`);
    }
  }

  const cookies = await page.cookies();
  console.log('\nCookies:', cookies.map(c => `${c.name}=${c.value.substring(0, 50)}`));

  console.log('\n=== API calls captured ===');
  for (const call of apiCalls) {
    if (!call.url.includes('googleapis.com/css')) {
      console.log(`${call.method} ${call.url.substring(0, 150)}`);
      if (call.postData) console.log(`  Body: ${call.postData.substring(0, 200)}`);
    }
  }

  await browser.close();
})().catch(e => console.error(e.message));
