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

  // 1. Try different search param names
  console.log('=== Search param variations ===');
  const searchParams = [
    { search: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { text: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { q: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { searchQuery: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { term: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { name: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { playerName: 'Mike Trout', collectibleType: 'sports-card', limit: 2 },
    { filters: { playerName: 'Mike Trout' }, collectibleType: 'sports-card', limit: 2 },
    { filters: { query: 'Mike Trout' }, collectibleType: 'sports-card', limit: 2 },
    { filters: { search: 'Mike Trout' }, collectibleType: 'sports-card', limit: 2 },
  ];

  for (const input of searchParams) {
    const r = await trpcGet('public.collectibles.search', input);
    if (r.status === 200) {
      const data = JSON.parse(r.data);
      const firstItem = data?.result?.data?.items?.[0]?.item;
      const name = firstItem?.player?.name || firstItem?.searchTitle?.substring(0, 50) || 'no data';
      console.log(`  ${JSON.stringify(Object.keys(input).filter(k => k !== 'collectibleType' && k !== 'limit'))}: player="${name}"`);
    }
  }

  // 2. Try player search first, then use player ID
  console.log('\n=== Player search ===');
  const playerSearchEndpoints = [
    'public.players.search',
    'private.players.search',
    'public.players.list',
    'private.players.list',
    'public.players.autocomplete',
    'private.players.autocomplete',
  ];
  for (const proc of playerSearchEndpoints) {
    for (const input of [
      { query: 'Mike Trout', limit: 3 },
      { search: 'Mike Trout', limit: 3 },
      { q: 'Mike Trout', limit: 3 },
      { filters: { query: 'Mike Trout' }, limit: 3 },
      { filters: { search: 'Mike Trout' }, limit: 3 },
    ]) {
      const r = await trpcGet(proc, input);
      if (r.status === 200 && r.data.includes('Trout')) {
        console.log(`\n  HIT: ${proc} with ${JSON.stringify(input)}`);
        console.log(`  ${r.data.substring(0, 1000)}`);
        break;
      }
    }
  }

  // 3. Get card detail via SSR (__NEXT_DATA__)
  console.log('\n=== Card detail via SSR ===');
  await page.goto('https://marketmovers.sportscardinvestor.com/sports-card/1116817', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 3000));

  const nextData = await page.evaluate(() => {
    return JSON.stringify(window.__NEXT_DATA__);
  });
  console.log('__NEXT_DATA__:', nextData?.substring(0, 5000));

  // 4. Also try: do a search from the actual UI and intercept the tRPC calls
  console.log('\n\n=== UI search interception ===');
  const searchCalls = [];
  const searchListener = async (res) => {
    const url = res.url();
    const req = res.request();
    if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') &&
        url.includes('cloudfront') && !url.includes('private.user')) {
      try {
        const text = await res.text();
        searchCalls.push({ url: decodeURIComponent(url), body: text.substring(0, 3000) });
      } catch (e) {}
    }
  };
  page.on('response', searchListener);

  // Go to dashboard and try the search
  await page.goto('https://marketmovers.sportscardinvestor.com/sports-card/search', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 2000));

  // Get page HTML to understand the search UI
  const pageHtml = await page.content();
  const searchInputs = await page.$$eval('input', els => els.map(el => ({
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    'data-testid': el.getAttribute('data-testid'),
    class: el.className?.substring(0, 80),
    ariaLabel: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
  })));
  console.log('Search page inputs:', JSON.stringify(searchInputs, null, 2));

  // Try to find any search-related elements
  const searchElements = await page.$$eval('[class*="search" i], [id*="search" i], [placeholder*="search" i], [role="search"], [role="searchbox"], [role="combobox"]', els => els.map(el => ({
    tag: el.tagName,
    type: el.type,
    placeholder: el.placeholder,
    id: el.id,
    class: el.className?.substring(0, 80),
    role: el.getAttribute('role'),
  })));
  console.log('\nSearch-related elements:', JSON.stringify(searchElements, null, 2));

  // Type in first available text input
  const allInputs = await page.$$('input[type="text"], input:not([type])');
  if (allInputs.length > 0) {
    console.log(`\nTyping in first text input...`);
    await allInputs[0].click();
    await allInputs[0].type('Mike Trout', { delay: 100 });
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\nCaptured ${searchCalls.length} search-related calls:`);
  for (const call of searchCalls) {
    console.log(`\n  URL: ${call.url.substring(0, 300)}`);
    console.log(`  Body: ${call.body.substring(0, 1500)}`);
  }

  await browser.close();
})().catch(e => console.error(e.message));
