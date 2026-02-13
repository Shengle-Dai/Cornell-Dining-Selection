/**
 * Cornell Dining Subscribe/Unsubscribe Worker
 *
 * Endpoints:
 *   GET  /                     — Subscribe form
 *   POST /api/subscribe        — Start subscribe flow (triggers verification email)
 *   GET  /api/confirm          — Confirm subscription (verifies HMAC token)
 *   GET  /api/unsubscribe      — Remove subscription (verifies HMAC token)
 *   GET  /api/subscribers      — List confirmed subscribers (internal, requires auth)
 *
 * KV keys: "sub:<email>" → JSON { subscribedAt }
 * Secrets: HMAC_SECRET, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
 */

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
  // Constant-time comparison
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

// ─── HTML templates ─────────────────────────────────────────────────────────

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { font-size: 24px; color: #f8fafc; margin-bottom: 8px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
    label { font-size: 13px; color: #cbd5e1; display: block; margin-bottom: 6px; }
    input[type="email"] {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #475569;
      border-radius: 8px;
      background: #0f172a;
      color: #f1f5f9;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="email"]:focus { border-color: #e67e22; }
    button {
      width: 100%;
      padding: 12px;
      margin-top: 16px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #e67e22, #d35400);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .msg { text-align: center; }
    .msg.success { color: #4ade80; }
    .msg.error { color: #f87171; }
    .emoji { font-size: 48px; margin-bottom: 16px; display: block; text-align: center; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">${bodyHtml}</div>
</body>
</html>`;
}

function subscribePage() {
  return pageShell(
    "Cornell West Campus Dining Picks",
    `
    <span class="emoji">🍽️</span>
    <h1>Daily Dining Picks</h1>
    <p>Get daily AI-powered dining recommendations for Cornell's West Campus, delivered to your inbox every morning.</p>
    <form method="POST" action="/api/subscribe">
      <label for="email">Email address</label>
      <input type="email" id="email" name="email" placeholder="netid@cornell.edu" required>
      <button type="submit">Subscribe</button>
    </form>
    <div class="footer">We'll send a confirmation email to verify your address.</div>
    `
  );
}

function resultPage(emoji, title, message, isError = false) {
  return pageShell(
    title,
    `
    <span class="emoji">${emoji}</span>
    <h1>${title}</h1>
    <p class="msg ${isError ? "error" : "success"}">${message}</p>
    `
  );
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleSubscribe(request, env) {
  const contentType = request.headers.get("content-type") || "";
  let email = "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    email = (form.get("email") || "").toString().trim().toLowerCase();
  } else if (contentType.includes("application/json")) {
    const body = await request.json();
    email = (body.email || "").toString().trim().toLowerCase();
  }

  // Basic validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      resultPage("⚠️", "Invalid Email", "Please enter a valid email address.", true),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  // Check if already subscribed
  const existing = await env.SUBSCRIBERS.get(`sub:${email}`);
  if (existing) {
    return new Response(
      resultPage("📬", "Already Subscribed", "This email is already receiving daily dining picks!"),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Generate HMAC token
  const token = await hmacSign(env.HMAC_SECRET, email);
  const workerUrl = new URL(request.url).origin;
  const confirmUrl = `${workerUrl}/api/confirm?email=${encodeURIComponent(email)}&token=${token}`;

  // Trigger GitHub Actions to send verification email
  const dispatchRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cornell-dining-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "send_verification",
        client_payload: {
          email: email,
          confirm_url: confirmUrl,
        },
      }),
    }
  );

  if (!dispatchRes.ok) {
    const errText = await dispatchRes.text();
    console.error("GitHub dispatch failed:", dispatchRes.status, errText);
    return new Response(
      resultPage("❌", "Something Went Wrong", "Failed to send verification email. Please try again later.", true),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  return new Response(
    resultPage(
      "📧",
      "Check Your Inbox",
      `We've sent a confirmation email to <strong>${email}</strong>. Click the link inside to activate your subscription. (It may take up to a minute to arrive.)`
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleConfirm(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";

  if (!email || !token) {
    return new Response(
      resultPage("⚠️", "Invalid Link", "This confirmation link is invalid.", true),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token);
  if (!valid) {
    return new Response(
      resultPage("🚫", "Invalid Token", "This confirmation link is invalid or has been tampered with.", true),
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }

  // Check if already subscribed
  const existing = await env.SUBSCRIBERS.get(`sub:${email}`);
  if (existing) {
    return new Response(
      resultPage("📬", "Already Subscribed", "You're already subscribed! Daily picks are on their way."),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Add to KV
  await env.SUBSCRIBERS.put(
    `sub:${email}`,
    JSON.stringify({ subscribedAt: new Date().toISOString() })
  );

  return new Response(
    resultPage(
      "✅",
      "You're Subscribed!",
      "You'll start receiving daily West Campus dining recommendations. Welcome aboard!"
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";

  if (!email || !token) {
    return new Response(
      resultPage("⚠️", "Invalid Link", "This unsubscribe link is invalid.", true),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token);
  if (!valid) {
    return new Response(
      resultPage("🚫", "Invalid Token", "This unsubscribe link is invalid or has been tampered with.", true),
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }

  // Remove from KV
  await env.SUBSCRIBERS.delete(`sub:${email}`);

  return new Response(
    resultPage(
      "👋",
      "Unsubscribed",
      "You've been removed from the daily dining picks. You can re-subscribe anytime!"
    ),
    { headers: { "Content-Type": "text/html" } }
  );
}

async function handleListSubscribers(request, env) {
  // Protected endpoint — only callable from GitHub Actions with the correct token
  const authHeader = request.headers.get("Authorization") || "";
  const expected = `Bearer ${env.HMAC_SECRET}`;
  if (authHeader !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscribers = [];
  let cursor = null;

  do {
    const result = await env.SUBSCRIBERS.list({
      prefix: "sub:",
      cursor: cursor,
      limit: 1000,
    });
    for (const key of result.keys) {
      // Key name is "sub:email@example.com"
      subscribers.push(key.name.slice(4));
    }
    cursor = result.list_complete ? null : result.cursor;
  } while (cursor);

  return Response.json({ subscribers });
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
        return new Response(subscribePage(), {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (path === "/api/subscribe" && request.method === "POST") {
        return await handleSubscribe(request, env);
      }

      if (path === "/api/confirm" && request.method === "GET") {
        return await handleConfirm(request, env);
      }

      if (path === "/api/unsubscribe" && request.method === "GET") {
        return await handleUnsubscribe(request, env);
      }

      if (path === "/api/subscribers" && request.method === "GET") {
        return await handleListSubscribers(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(
        resultPage("💥", "Error", "Something went wrong. Please try again.", true),
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }
  },
};
