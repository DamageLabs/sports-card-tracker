const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // Visible browser to debug UI interactions
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
        url.includes('nr-data') || url.includes('firebase') || url.includes('.woff')) return;
    try {
      const text = await res.text();
      const entry = {
        ts: Date.now(),
        method: req.method(),
        url: decodeURIComponent(url),
        status: res.status(),
        body: text.substring(0, 3000),
      };
      apiCalls.push(entry);
      // Print search-related calls immediately
      if (url.includes('search') || url.includes('autocomplete') || url.includes('suggest') ||
          url.includes('Trout') || url.includes('trout')) {
        console.log(`\n>>> SEARCH CALL: ${entry.method} ${entry.url.substring(0, 200)}`);
        console.log(`    Body: ${entry.body.substring(0, 1000)}`);
      }
    } catch (e) {}
  });

  // Login
  console.log('=== Logging in ===');
  await page.goto('https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await page.type('#user_login', 'fusion94@gmail.com');
  await page.type('#user_pass', 'EclkPnyy$$1');
  await page.click('#wp-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Logged in, on:', page.url());

  // Wait for dashboard to fully load
  await new Promise(r => setTimeout(r, 3000));

  // Get all interactive elements
  console.log('\n=== Dashboard interactive elements ===');
  const interactive = await page.evaluate(() => {
    const els = document.querySelectorAll('input, button, [role="button"], [role="search"], [role="combobox"], [role="searchbox"], [contenteditable], a[href*="search"]');
    return Array.from(els).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      text: el.textContent?.trim().substring(0, 50),
      placeholder: el.placeholder || '',
      id: el.id || '',
      class: el.className?.toString().substring(0, 80) || '',
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      href: el.href || '',
      rect: el.getBoundingClientRect(),
    })).filter(e =>
      e.text?.toLowerCase().includes('search') ||
      e.placeholder?.toLowerCase().includes('search') ||
      e.ariaLabel?.toLowerCase().includes('search') ||
      e.role === 'search' || e.role === 'searchbox' || e.role === 'combobox' ||
      e.type === 'search' || e.type === 'text' ||
      e.tag === 'INPUT'
    );
  });
  console.log(JSON.stringify(interactive, null, 2));

  // Try clicking search-like elements
  const searchEls = interactive.filter(e =>
    e.text?.toLowerCase().includes('search') ||
    e.placeholder?.toLowerCase().includes('search') ||
    e.ariaLabel?.toLowerCase().includes('search')
  );
  console.log(`\nFound ${searchEls.length} search-like elements`);

  if (searchEls.length > 0) {
    for (const el of searchEls) {
      console.log(`  Clicking: ${el.tag} "${el.text}" at (${el.rect.x}, ${el.rect.y})`);
      try {
        await page.mouse.click(el.rect.x + el.rect.width / 2, el.rect.y + el.rect.height / 2);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.log(`  Click failed: ${e.message}`);
      }
    }
  }

  // Wait and check for any new inputs (search modal might have appeared)
  await new Promise(r => setTimeout(r, 2000));
  const newInputs = await page.$$eval('input', els => els.map(el => ({
    type: el.type,
    placeholder: el.placeholder,
    visible: el.offsetParent !== null,
    rect: el.getBoundingClientRect(),
  })));
  console.log('\nAll inputs after clicking:', JSON.stringify(newInputs, null, 2));

  // Try typing in visible inputs
  const visibleInputs = newInputs.filter(i => i.visible && i.rect.width > 0);
  if (visibleInputs.length > 0) {
    console.log(`\nTyping in ${visibleInputs.length} visible inputs...`);
    for (const inp of visibleInputs) {
      try {
        await page.mouse.click(inp.rect.x + inp.rect.width / 2, inp.rect.y + inp.rect.height / 2);
        await page.keyboard.type('Mike Trout', { delay: 100 });
        await new Promise(r => setTimeout(r, 5000));
        console.log('Typed in input, waiting for results...');
      } catch (e) {
        console.log(`  Type failed: ${e.message}`);
      }
    }
  }

  // Also try keyboard shortcut (many apps use Ctrl+K or / for search)
  console.log('\n=== Trying keyboard shortcuts for search ===');
  apiCalls.length = 0; // Clear to only see search-related calls

  await page.keyboard.press('/');
  await new Promise(r => setTimeout(r, 1000));
  let searchOpened = await page.evaluate(() => {
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="search"], [class*="overlay"]');
    return Array.from(modals).map(m => ({
      tag: m.tagName,
      class: m.className?.toString().substring(0, 80),
      visible: m.offsetParent !== null,
    }));
  });
  console.log('After /:', JSON.stringify(searchOpened));

  // Try Ctrl+K
  await page.keyboard.down('Meta');
  await page.keyboard.press('k');
  await page.keyboard.up('Meta');
  await new Promise(r => setTimeout(r, 1000));
  searchOpened = await page.evaluate(() => {
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="search"], [class*="overlay"]');
    return Array.from(modals).map(m => ({
      tag: m.tagName,
      class: m.className?.toString().substring(0, 80),
      visible: m.offsetParent !== null,
    }));
  });
  console.log('After Cmd+K:', JSON.stringify(searchOpened));

  // Print all non-user API calls
  console.log(`\n\n=== All captured API calls (${apiCalls.length}) ===`);
  for (const call of apiCalls) {
    if (!call.url.includes('private.user')) {
      console.log(`\n${call.method} ${call.url.substring(0, 300)}`);
      console.log(`  Status: ${call.status}`);
      console.log(`  Body: ${call.body.substring(0, 1000)}`);
    }
  }

  await browser.close();
})().catch(e => console.error(e.message));
