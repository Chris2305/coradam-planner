/**
 * Coradam Planner — Freshbooks Worker
 * Paste this entire file into the Cloudflare Workers code editor.
 *
 * Required environment variables (set in Cloudflare dashboard → Settings → Variables):
 *   FRESHBOOKS_CLIENT_ID     — from Freshbooks Developer Hub
 *   FRESHBOOKS_CLIENT_SECRET — from Freshbooks Developer Hub
 *   FIREBASE_API_KEY         — your Firebase API key (AIzaSy...)
 *
 * Required KV namespace binding (set in Cloudflare dashboard → Settings → Bindings):
 *   Variable name: FB_TOKENS   (bind to a KV namespace you create called "fb-tokens")
 */

const FB_TOKEN_URL = 'https://api.freshbooks.com/auth/oauth/token';
const FB_API       = 'https://api.freshbooks.com';
const APP_URL      = 'https://planner.coradam.com';
const SUPER_ADMIN  = 'c.nocher@coradam.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      'Access-Control-Allow-Origin':  APP_URL,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle browser preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/callback') return handleCallback(request, env, url, cors);
    if (url.pathname === '/api')      return handleApi(request, env, cors);

    return new Response('Coradam Planner — Freshbooks Worker is running.', { headers: cors });
  },
};

// ─────────────────────────────────────────────────────────────
// OAuth callback — Freshbooks redirects here with ?code=...
// ─────────────────────────────────────────────────────────────
async function handleCallback(request, env, url, cors) {
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) return Response.redirect(`${APP_URL}?fb=error&msg=${encodeURIComponent(error)}`);
  if (!code)  return new Response('Missing code', { status: 400 });

  try {
    const callbackUrl = `${url.origin}/callback`;

    // Exchange the authorisation code for access + refresh tokens
    const tokenRes  = await fetch(FB_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'authorization_code',
        client_id:     env.FRESHBOOKS_CLIENT_ID,
        client_secret: env.FRESHBOOKS_CLIENT_SECRET,
        code,
        redirect_uri:  callbackUrl,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(tokenData));

    // Fetch the Freshbooks account ID
    const meRes  = await fetch(`${FB_API}/auth/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData    = await meRes.json();
    const accountId = meData.response?.business_memberships?.[0]?.business?.account_id || null;

    // Store tokens in Cloudflare KV
    await env.FB_TOKENS.put('data', JSON.stringify({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at:    Date.now() + tokenData.expires_in * 1000,
      account_id:    accountId,
      connected_at:  Date.now(),
    }));

    return Response.redirect(`${APP_URL}?fb=connected`);
  } catch (e) {
    return Response.redirect(`${APP_URL}?fb=error&msg=${encodeURIComponent(e.message)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// API proxy — called by the planner frontend (super admin only)
// ─────────────────────────────────────────────────────────────
async function handleApi(request, env, cors) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  // Verify the caller is the super admin via their Firebase ID token
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.replace('Bearer ', '').trim();
  if (!idToken) return jsonResponse({ error: 'Missing token' }, 401, cors);

  const user = await verifyFirebaseToken(idToken, env.FIREBASE_API_KEY);
  if (!user || user.email !== SUPER_ADMIN) {
    return jsonResponse({ error: 'Forbidden — super admin only' }, 403, cors);
  }

  const { action, payload } = await request.json();

  try {
    // ── Connection status ──────────────────────────────────
    if (action === 'status') {
      const raw    = await env.FB_TOKENS.get('data');
      const stored = raw ? JSON.parse(raw) : null;
      return jsonResponse({
        connected:    !!stored,
        account_id:   stored?.account_id   || null,
        connected_at: stored?.connected_at || null,
      }, 200, cors);
    }

    // All other actions need valid tokens
    const raw = await env.FB_TOKENS.get('data');
    if (!raw) throw new Error('Freshbooks not connected. Please connect first.');
    let stored = JSON.parse(raw);

    // Refresh the access token if it's about to expire
    if (Date.now() >= stored.expires_at - 60_000) {
      stored = await refreshTokens(stored, env);
    }

    const authH = {
      Authorization:  `Bearer ${stored.access_token}`,
      'Content-Type': 'application/json',
    };

    // ── List clients ───────────────────────────────────────
    if (action === 'listClients') {
      const page = payload?.page || 1;
      const r    = await fetch(
        `${FB_API}/accounting/account/${stored.account_id}/users/clients?vis_state=0&per_page=100&page=${page}`,
        { headers: authH }
      );
      return jsonResponse(await r.json(), 200, cors);
    }

    // ── Create estimate ────────────────────────────────────
    if (action === 'createEstimate') {
      const r = await fetch(
        `${FB_API}/accounting/account/${stored.account_id}/estimates/estimates`,
        { method: 'POST', headers: authH, body: JSON.stringify(payload) }
      );
      return jsonResponse(await r.json(), 200, cors);
    }

    throw new Error('Unknown action: ' + action);

  } catch (e) {
    // Log the full error server-side (visible in Cloudflare dashboard → Logs) but return a generic
    // message to the client to avoid leaking internal details (stack traces, API error payloads, etc.)
    console.error('[Coradam Worker] handleApi error:', e);
    return jsonResponse({ error: 'An internal error occurred. Please try again.' }, 500, cors);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function verifyFirebaseToken(idToken, apiKey) {
  try {
    const res  = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    const data = await res.json();
    return data.users?.[0] || null;
  } catch {
    return null;
  }
}

async function refreshTokens(stored, env) {
  const res  = await fetch(FB_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'refresh_token',
      client_id:     env.FRESHBOOKS_CLIENT_ID,
      client_secret: env.FRESHBOOKS_CLIENT_SECRET,
      refresh_token: stored.refresh_token,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed');
  const updated = {
    ...stored,
    access_token:  data.access_token,
    refresh_token: data.refresh_token || stored.refresh_token,
    expires_at:    Date.now() + data.expires_in * 1000,
  };
  await env.FB_TOKENS.put('data', JSON.stringify(updated));
  return updated;
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}