/**
 * Campus Meal Pick (CMP) — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /                        — Landing page with "Sign in with Google" button
 *   GET  /auth/callback            — Supabase OAuth callback handler
 *   GET  /onboarding               — Preference selection page (JWT-authed)
 *   GET  /api/onboarding-dishes    — Fetch onboarding dish list (JWT-authed)
 *   POST /api/preferences          — Set initial preferences + onboarding ratings (JWT-authed)
 *   GET  /api/unsubscribe          — Remove subscription (HMAC-verified email link)
 *   GET  /api/rate                 — Rate a dish (HMAC-verified email link)
 *
 * Env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, HMAC_SECRET
 */

import { createClient } from "@supabase/supabase-js";

// ─── Supabase helpers ───────────────────────────────────────────────────────

function createSupabaseClient(env, authHeader = null) {
  const opts = {
    auth: { autoRefreshToken: false, persistSession: false },
  };
  if (authHeader) {
    opts.global = { headers: { Authorization: authHeader } };
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);
}

function createServiceClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─── Crypto helpers ─────────────────────────────────────────────────────────

async function hmacSign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacVerify(secret, data, token) {
  const expected = await hmacSign(secret, data);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

// ─── HTML templates ─────────────────────────────────────────────────────────

function pageShell(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { --cornell-red: #B31B1B; --text: #222; --text-light: #555; --bg: #ffffff; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    h1 {
      font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
      color: var(--cornell-red);
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px;
      letter-spacing: -0.01em;
    }
    p {
      color: var(--text-light);
      font-size: 16px;
      line-height: 1.5;
      margin: 0 0 32px;
    }
    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px;
      margin-top: 10px;
      background: transparent;
      color: var(--cornell-red);
      border: 1px solid var(--cornell-red);
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }
    button:hover, .btn:hover {
      background: var(--cornell-red);
      color: white;
    }
    .icon {
      margin-bottom: 24px;
      color: var(--cornell-red);
    }
    .icon svg {
      width: 32px;
      height: 32px;
    }
    .footer {
      margin-top: 40px;
      font-size: 12px;
      color: #999;
      font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
      font-style: italic;
    }
    a { color: var(--cornell-red); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .edu-note {
      font-size: 12px;
      color: #999;
      margin-top: 12px;
    }

    .how-it-works {
      margin-top: 60px;
      padding-top: 40px;
      border-top: 1px solid #eaeaea;
      display: flex;
      justify-content: center;
      gap: 40px;
      flex-wrap: wrap;
    }
    .step {
      flex: 1;
      min-width: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      opacity: 0;
      animation: fadeUp 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }
    .step:nth-child(1) { animation-delay: 0.2s; }
    .step:nth-child(2) { animation-delay: 0.4s; }
    .step:nth-child(3) { animation-delay: 0.6s; }

    .step-icon {
      width: 56px;
      height: 56px;
      color: var(--cornell-red);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      transition: transform 0.4s ease;
    }
    .step:hover .step-icon {
      transform: translateY(-5px);
    }
    .step-icon svg {
      width: 32px;
      height: 32px;
      stroke-width: 1;
    }

    .step h3 {
      font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 8px;
    }
    .step p {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #777;
      margin: 0;
      max-width: 160px;
    }

    /* Email Sample Preview */
    .email-preview {
      margin-top: 60px;
      padding: 0 20px;
      animation: fadeUp 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      animation-delay: 0.8s;
      opacity: 0;
      width: 100%;
      max-width: 480px;
      box-sizing: border-box;
    }
    .email-card {
      border: 1px solid #eaeaea;
      background: #fafafa;
      padding: 32px;
      text-align: left;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .email-meta {
      font-size: 11px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
    }
    .meal-section {
      margin-bottom: 24px;
    }
    .meal-title {
      font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
      font-size: 18px;
      color: var(--cornell-red);
      margin: 0 0 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .pick-item {
      margin-bottom: 16px;
    }
    .pick-header {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pick-rank {
      color: var(--cornell-red);
      font-size: 11px;
      background: rgba(179, 27, 27, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .pick-menu {
      font-size: 13px;
      color: #666;
      line-height: 1.4;
      margin: 0;
      padding-left: 0;
      list-style: none;
    }
    .pick-menu li {
      margin-bottom: 2px;
      position: relative;
      padding-left: 12px;
    }
    .pick-menu li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #ddd;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="container">${content}</div>
</body>
</html>`;
}

const icons = {
  email: `<div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>`,
  success: `<div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 13l4 4L19 7" /></svg></div>`,
  error: `<div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" /></svg></div>`,
  info: `<div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>`,
};

// Google logo SVG for the sign-in button
const googleLogo = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335"/></svg>`;

function landingPage(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const workerOrigin = env.WORKER_ORIGIN || "";

  return pageShell(
    "Campus Meal Pick",
    `
    <h1>Daily Dining Picks</h1>
    <p>Personalized recommendations for West Campus, powered by food2vec.</p>
    <a href="#" id="google-signin" class="btn">
      ${googleLogo}
      Sign in with Google
    </a>
    <p class="edu-note">Requires a .edu email address.</p>
    <div class="footer">No spam, just food.</div>

    <div class="how-it-works">
      <div class="step">
        <div class="step-icon">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3>Menu Scrape</h3>
        <p>Daily menus from West Campus dining halls.</p>
      </div>

      <div class="step">
        <div class="step-icon">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </div>
        <h3>AI Curates</h3>
        <p>Personalized picks via food2vec embeddings.</p>
      </div>

      <div class="step">
        <div class="step-icon">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3>You Eat</h3>
        <p>A clean daily email. Rate dishes to improve picks.</p>
      </div>
    </div>

    <!-- Email Preview -->
    <div class="email-preview">
      <div class="email-card">
        <div class="email-meta">
          <span>Fri, Feb 13</span>
          <span>Sample Email</span>
        </div>

        <div class="meal-section">
          <h2 class="meal-title">Lunch</h2>

          <div class="pick-item">
            <div class="pick-header">
              <span class="pick-rank">#1</span>
              <span>Becker House</span>
            </div>
            <ul class="pick-menu">
              <li>Sweet Chili Chicken Drumsticks</li>
              <li>Tofu & Vegetable Lo Mein</li>
            </ul>
          </div>

          <div class="pick-item">
            <div class="pick-header">
              <span class="pick-rank">#2</span>
              <span>Bethe House</span>
            </div>
            <ul class="pick-menu">
              <li>Sweet & Sour Pork</li>
              <li>Orange Tofu Stir Fry</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <script>
      document.getElementById('google-signin').addEventListener('click', async (e) => {
        e.preventDefault();
        const supabaseUrl = ${JSON.stringify(supabaseUrl)};
        const redirectTo = ${JSON.stringify(workerOrigin)}.replace(/\\/$/, '') + '/auth/callback';
        // Redirect to Supabase OAuth endpoint
        const url = supabaseUrl + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
        window.location.href = url;
      });
    </script>
    `
  );
}

function resultPage(type, title, message) {
  const icon = icons[type] || icons.info;
  return pageShell(
    title,
    `
    ${icon}
    <h1>${title}</h1>
    <p>${message}</p>
    `
  );
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleAuthCallback(request, env) {
  // Supabase redirects with a hash fragment containing the access token.
  // Since fragments aren't sent to the server, we need a client-side page
  // to extract the token and redirect appropriately.
  return new Response(
    pageShell(
      "Signing in...",
      `
      ${icons.info}
      <h1>Signing in...</h1>
      <p>Please wait while we complete your sign-in.</p>
      <script>
        (async () => {
          // Extract tokens from URL hash
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          const error = params.get('error_description') || params.get('error');

          if (error) {
            document.querySelector('.container').innerHTML =
              '${icons.error}<h1>Sign-in Failed</h1><p>' + error + '</p>';
            return;
          }

          if (!accessToken) {
            document.querySelector('.container').innerHTML =
              '${icons.error}<h1>Sign-in Failed</h1><p>No access token received.</p>';
            return;
          }

          // Store tokens in sessionStorage for the onboarding page
          sessionStorage.setItem('sb_access_token', accessToken);
          if (refreshToken) sessionStorage.setItem('sb_refresh_token', refreshToken);

          // Check if user already has preferences
          try {
            const supabaseUrl = ${JSON.stringify(env.SUPABASE_URL)};
            const resp = await fetch(supabaseUrl + '/rest/v1/user_preferences?select=user_id', {
              headers: {
                'Authorization': 'Bearer ' + accessToken,
                'apikey': ${JSON.stringify(env.SUPABASE_ANON_KEY)},
              }
            });
            const prefs = await resp.json();
            if (prefs && prefs.length > 0) {
              // Already onboarded
              document.querySelector('.container').innerHTML =
                '${icons.success}<h1>Welcome Back!</h1><p>You are already subscribed. Daily picks are on their way!</p>';
              return;
            }
          } catch (e) {
            // If check fails, just redirect to onboarding
          }

          // Redirect to onboarding
          window.location.href = '/onboarding';
        })();
      </script>
      `
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleOnboardingDishes(request, env) {
  // JWT-authenticated: fetch dishes where is_onboarding_dish = true
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  const supabase = createSupabaseClient(env, authHeader);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("dishes")
    .select("id, source_name, cuisine_type")
    .eq("is_onboarding_dish", true);

  if (error) {
    console.error("Onboarding dishes fetch error:", error);
    return Response.json({ error: "Failed to fetch onboarding dishes" }, { status: 500 });
  }

  return Response.json(data || []);
}

async function handleOnboarding(_request, _env) {
  const categories = [
    "Chinese", "Japanese", "Korean", "Indian", "Mexican",
    "Italian", "American", "Mediterranean", "Thai", "Vietnamese",
  ];
  const flavors = [
    "savory", "sweet", "spicy", "sour", "umami",
    "mild", "smoky", "tangy", "rich", "fresh",
  ];
  const methods = [
    "fried", "grilled", "baked", "steamed", "stir-fried",
    "roasted", "braised", "raw", "sauteed", "smoked",
  ];

  const catCheckboxes = categories
    .map(
      (c) =>
        `<label class="chip"><input type="checkbox" name="categories" value="${c.toLowerCase()}"> ${c}</label>`
    )
    .join("\n");

  const flavorCheckboxes = flavors
    .map(
      (f) =>
        `<label class="chip"><input type="checkbox" name="flavors" value="${f}"> ${f}</label>`
    )
    .join("\n");

  const methodCheckboxes = methods
    .map(
      (m) =>
        `<label class="chip"><input type="checkbox" name="methods" value="${m}"> ${m}</label>`
    )
    .join("\n");

  return new Response(
    pageShell(
      "Set Your Preferences",
      `
      ${icons.success}
      <h1>You're Subscribed!</h1>
      <p>Tell us what you like so we can personalize your picks.</p>
      <form id="pref-form" style="text-align:left;">
        <h3 style="font-size:14px;color:var(--cornell-red);margin:16px 0 8px;">Cuisines you enjoy</h3>
        <div class="chips">${catCheckboxes}</div>
        <h3 style="font-size:14px;color:var(--cornell-red);margin:16px 0 8px;">Flavors you enjoy</h3>
        <div class="chips">${flavorCheckboxes}</div>
        <h3 style="font-size:14px;color:var(--cornell-red);margin:16px 0 8px;">Cooking styles you prefer</h3>
        <div class="chips">${methodCheckboxes}</div>

        <h3 style="font-size:14px;color:var(--cornell-red);margin:24px 0 8px;">Rate these dishes (1 = dislike, 10 = love)</h3>
        <p style="font-size:12px;color:#999;margin:0 0 12px;">Slide to rate each dish — this gives us the best signal for your taste.</p>
        <div id="dish-sliders" style="display:flex;flex-direction:column;gap:14px;">
          <p style="color:#aaa;font-size:13px;">Loading dishes…</p>
        </div>

        <button type="submit" style="margin-top:24px;">Save Preferences</button>
      </form>
      <a href="/" class="footer" style="display:block;margin-top:16px;">Skip for now</a>
      <style>
        .chips { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
        .chip {
          display:inline-flex; align-items:center; gap:4px;
          padding:6px 12px; border:1px solid #ddd; border-radius:20px;
          font-size:13px; cursor:pointer; transition:all 0.2s;
        }
        .chip:has(input:checked) {
          background:var(--cornell-red); color:white; border-color:var(--cornell-red);
        }
        .chip input { display:none; }
        .dish-card {
          padding:10px 12px; border:1px solid #eee; border-radius:8px; background:#fafafa;
        }
        .dish-label {
          display:flex; justify-content:space-between; align-items:center;
          margin-bottom:6px;
        }
        .dish-name { font-size:13px; font-weight:600; color:#333; }
        .dish-cuisine { font-size:11px; color:#999; }
        .score-display {
          font-size:13px; font-weight:700; color:var(--cornell-red); min-width:20px; text-align:right;
        }
        input[type=range] {
          width:100%; accent-color:var(--cornell-red);
        }
      </style>
      <script>
        (async () => {
          const accessToken = sessionStorage.getItem('sb_access_token');
          const container = document.getElementById('dish-sliders');

          if (!accessToken) {
            container.innerHTML = '<p style="color:#aaa;font-size:13px;">Sign in to rate dishes.</p>';
            return;
          }

          try {
            const res = await fetch('/api/onboarding-dishes', {
              headers: { 'Authorization': 'Bearer ' + accessToken }
            });
            const dishes = await res.json();
            if (!dishes || dishes.length === 0) {
              container.innerHTML = '<p style="color:#aaa;font-size:13px;">No dishes available yet — your first email will use your cuisine & flavor picks instead.</p>';
              return;
            }
            container.innerHTML = dishes.map(d => \`
              <div class="dish-card" data-dish-id="\${d.id}">
                <div class="dish-label">
                  <span class="dish-name">\${d.source_name || 'Unknown dish'}</span>
                  <span><span class="score-display" id="score-\${d.id}">5</span>&nbsp;<span style="font-size:11px;color:#bbb;">/10</span></span>
                </div>
                <input type="range" min="1" max="10" value="5"
                  data-dish-id="\${d.id}"
                  oninput="document.getElementById('score-\${d.id}').textContent = this.value">
              </div>
            \`).join('');
          } catch (e) {
            container.innerHTML = '<p style="color:#aaa;font-size:13px;">Could not load dishes.</p>';
          }
        })();

        document.getElementById('pref-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const cats = [...document.querySelectorAll('input[name="categories"]:checked')].map(i => i.value);
          const flavs = [...document.querySelectorAll('input[name="flavors"]:checked')].map(i => i.value);
          const meths = [...document.querySelectorAll('input[name="methods"]:checked')].map(i => i.value);
          const dishRatings = [...document.querySelectorAll('input[type=range][data-dish-id]')].map(el => ({
            dish_id: parseInt(el.dataset.dishId, 10),
            score: parseInt(el.value, 10),
          }));
          const accessToken = sessionStorage.getItem('sb_access_token');
          if (!accessToken) {
            alert('Session expired. Please sign in again.');
            window.location.href = '/';
            return;
          }
          try {
            const res = await fetch('/api/preferences', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken,
              },
              body: JSON.stringify({ categories: cats, ingredients: [], flavors: flavs, methods: meths, dish_ratings: dishRatings })
            });
            if (res.ok) {
              document.querySelector('.container').innerHTML =
                '${icons.success}<h1>Preferences Saved!</h1><p>Your daily picks will be personalized starting tomorrow.</p>';
            } else {
              const data = await res.json().catch(() => ({}));
              alert(data.error || 'Failed to save. Please try again.');
            }
          } catch (err) {
            alert('Failed to save. Please try again.');
          }
        });
      </script>
      `
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleSetPreferences(request, env) {
  // JWT-authenticated: extract user from Supabase token
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  const supabase = createSupabaseClient(env, authHeader);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json();
  const categories = body.categories || [];
  const ingredients = body.ingredients || [];
  const flavors = body.flavors || [];
  const methods = body.methods || [];
  const dishRatings = body.dish_ratings || [];  // [{dish_id: int, score: int}]

  // Upsert user_preferences using service role (to bypass RLS for upsert)
  const service = createServiceClient(env);
  const { error } = await service.from("user_preferences").upsert(
    {
      user_id: user.id,
      initial_categories: categories,
      initial_ingredients: ingredients,
      preferred_flavors: flavors,
      preferred_methods: methods,
      vector_stale: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Preferences upsert error:", error);
    return Response.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  // Insert onboarding dish ratings with continuous strength signal
  if (dishRatings.length > 0) {
    const today = new Date().toISOString().split("T")[0];
    const rows = dishRatings.map(({ dish_id, score }) => {
      const direction = score >= 6 ? 1 : -1;
      const strength = Math.abs(score - 5.5) / 4.5;
      return { user_id: user.id, dish_id, rating: direction, strength, menu_date: today };
    });
    const { error: ratingError } = await service
      .from("ratings")
      .upsert(rows, { onConflict: "user_id,dish_id,menu_date" });
    if (ratingError) {
      console.error("Onboarding ratings upsert error:", ratingError);
      // Non-fatal: preferences were saved; ratings are bonus signal
    }
  }

  return Response.json({ ok: true });
}

async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";

  if (!email || !token) {
    return new Response(
      resultPage("error", "Invalid Link", "This unsubscribe link is invalid."),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token);
  if (!valid) {
    return new Response(
      resultPage(
        "error",
        "Invalid Token",
        "This unsubscribe link is invalid or has been tampered with."
      ),
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }

  // Update profiles.subscribed = false via service role
  const service = createServiceClient(env);
  const { error } = await service
    .from("profiles")
    .update({ subscribed: false, updated_at: new Date().toISOString() })
    .eq("email", email);

  if (error) {
    console.error("Unsubscribe error:", error);
    return new Response(
      resultPage("error", "Error", "Something went wrong. Please try again."),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  return new Response(
    resultPage(
      "success",
      "Unsubscribed",
      "You've been removed from the daily dining picks. You can re-subscribe anytime by signing in again!"
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleRate(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";
  const menuId = url.searchParams.get("menu_id") || "";
  const date = url.searchParams.get("date") || "";
  const rating = url.searchParams.get("rating") || "";

  if (
    !email ||
    !token ||
    !menuId ||
    !date ||
    !["up", "down"].includes(rating)
  ) {
    return new Response(
      resultPage("error", "Invalid Link", "This rating link is invalid."),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token);
  if (!valid) {
    return new Response(
      resultPage(
        "error",
        "Invalid Token",
        "This rating link is invalid or has been tampered with."
      ),
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }

  const service = createServiceClient(env);

  // Look up user by email
  const { data: profiles } = await service
    .from("profiles")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (!profiles || profiles.length === 0) {
    return new Response(
      resultPage("error", "User Not Found", "No account found for this email."),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }
  const userId = profiles[0].id;

  // Look up the daily menu entry to get dish_id
  const { data: menuEntry } = await service
    .from("daily_menus")
    .select("dish_id, dishes(source_name)")
    .eq("id", menuId)
    .limit(1);

  if (!menuEntry || menuEntry.length === 0) {
    return new Response(
      resultPage(
        "error",
        "Dish Not Found",
        "This dish is no longer available for rating."
      ),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const dishId = menuEntry[0].dish_id;
  const dishName = menuEntry[0].dishes?.source_name || "this dish";
  const ratingValue = rating === "up" ? 1 : -1;

  // Upsert rating
  const { error: ratingError } = await service.from("ratings").upsert(
    {
      user_id: userId,
      dish_id: dishId,
      rating: ratingValue,
      menu_date: date,
    },
    { onConflict: "user_id,dish_id,menu_date" }
  );

  if (ratingError) {
    console.error("Rating upsert error:", ratingError);
    return new Response(
      resultPage("error", "Error", "Failed to save your rating. Please try again."),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  // Mark preference vector as stale
  await service.from("user_preferences").upsert(
    {
      user_id: userId,
      vector_stale: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  const message =
    rating === "up"
      ? `Glad you liked <strong>${dishName}</strong>! We'll recommend more like it.`
      : `Got it — we'll show less of <strong>${dishName}</strong> in the future.`;

  return new Response(
    resultPage("success", rating === "up" ? "Liked!" : "Noted!", message),
    { headers: { "Content-Type": "text/html" } }
  );
}

// ─── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for API endpoints
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/" && request.method === "GET") {
        return new Response(landingPage(env), {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (path === "/auth/callback" && request.method === "GET") {
        return await handleAuthCallback(request, env);
      }

      if (path === "/onboarding" && request.method === "GET") {
        return await handleOnboarding(request, env);
      }

      if (path === "/api/onboarding-dishes" && request.method === "GET") {
        return await handleOnboardingDishes(request, env);
      }

      if (path === "/api/preferences" && request.method === "POST") {
        return await handleSetPreferences(request, env);
      }

      if (path === "/api/unsubscribe" && request.method === "GET") {
        return await handleUnsubscribe(request, env);
      }

      if (path === "/api/rate" && request.method === "GET") {
        return await handleRate(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(
        resultPage("error", "Error", "Something went wrong. Please try again."),
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }
  },
};
