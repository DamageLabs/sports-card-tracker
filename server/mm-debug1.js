// Explore Market Movers auth and internal API
// marketmovers.sportscardinvestor.com is a Next.js app

(async () => {
  const BASE = 'https://marketmovers.sportscardinvestor.com';

  // Step 1: Check if there's a Next.js API route for auth
  console.log('=== Checking auth endpoints ===');

  const authEndpoints = [
    '/api/auth/signin',
    '/api/auth/session',
    '/api/auth/providers',
    '/api/auth/csrf',
    '/api/login',
    '/api/v1/auth/login',
  ];

  for (const ep of authEndpoints) {
    try {
      const res = await fetch(`${BASE}${ep}`, {
        headers: { 'Accept': 'application/json' },
      });
      console.log(`${ep}: ${res.status} ${res.headers.get('content-type')}`);
      if (res.ok && res.headers.get('content-type')?.includes('json')) {
        const data = await res.json();
        console.log(`  ${JSON.stringify(data).substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`${ep}: ${e.message}`);
    }
  }

  // Step 2: Check for GraphQL endpoint
  console.log('\n=== Checking GraphQL ===');
  try {
    const res = await fetch(`${BASE}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __schema { types { name } } }' }),
    });
    console.log(`/api/graphql: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`  ${JSON.stringify(data).substring(0, 500)}`);
    }
  } catch (e) {
    console.log(`GraphQL: ${e.message}`);
  }

  // Step 3: Try the marketing site for API hints
  console.log('\n=== Checking marketmoversapp.com ===');
  try {
    const res = await fetch('https://marketmoversapp.com/api/auth/providers');
    console.log(`marketmoversapp.com providers: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`  ${JSON.stringify(data).substring(0, 500)}`);
    }
  } catch (e) {
    console.log(`  ${e.message}`);
  }

  // Step 4: Check main page for clues (meta tags, scripts)
  console.log('\n=== Fetching main page ===');
  try {
    const res = await fetch(BASE, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    console.log(`Status: ${res.status}`);
    const html = await res.text();

    // Look for API base URLs, auth config, etc.
    const patterns = [
      /NEXT_PUBLIC_API[^"']*/g,
      /api\.sportscardinvestor[^"'\s]*/g,
      /supabase[^"'\s]*/gi,
      /firebase[^"'\s]*/gi,
      /cognito[^"'\s]*/gi,
      /auth0[^"'\s]*/gi,
      /clerk[^"'\s]*/gi,
      /stripe[^"'\s]*/gi,
      /"apiUrl"\s*:\s*"[^"]+"/g,
      /"baseUrl"\s*:\s*"[^"]+"/g,
      /https?:\/\/[^"'\s]*api[^"'\s]*/g,
    ];

    for (const pat of patterns) {
      const matches = html.match(pat);
      if (matches) {
        console.log(`  Pattern ${pat.source}:`);
        for (const m of [...new Set(matches)].slice(0, 5)) {
          console.log(`    ${m}`);
        }
      }
    }

    // Check for __NEXT_DATA__
    const nextDataMatch = html.match(/__NEXT_DATA__[^{]*({[^<]+})/);
    if (nextDataMatch) {
      console.log('\n  __NEXT_DATA__ found:');
      console.log(`    ${nextDataMatch[1].substring(0, 500)}`);
    }
  } catch (e) {
    console.log(`  ${e.message}`);
  }
})().catch(e => console.error(e.message));
