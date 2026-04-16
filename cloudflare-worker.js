/**
 * Coradam Planner — Cloudflare Worker
 * Paste this entire file into the Cloudflare Workers code editor.
 *
 * Required environment variables (set in Cloudflare dashboard → Settings → Variables):
 *   FRESHBOOKS_CLIENT_ID     — from Freshbooks Developer Hub
 *   FRESHBOOKS_CLIENT_SECRET — from Freshbooks Developer Hub
 *   FIREBASE_API_KEY         — your Firebase API key (AIzaSy...)
 *   FIREBASE_DATABASE_URL    — your Firebase RTDB URL (https://xxx-default-rtdb.firebaseio.com)
 *
 * Required KV namespace bindings (Cloudflare dashboard → Settings → Bindings):
 *   FB_TOKENS        — KV namespace for Freshbooks OAuth tokens  (required)
 *   ANALYTICS_CACHE  — KV namespace for analytics response cache (optional, enables BE-18 caching)
 *
 * ─── Booking timestamp policy (BE-01) ──────────────────────────────────────
 * Every entry in Firebase has two timestamp fields (Unix ms):
 *   entry.created  — set once at booking creation; preserved on all subsequent edits.
 *                    Legacy entries missing this field fall back to entry.updated.
 *   entry.updated  — refreshed on every save (creation or edit).
 * The analytics layer uses entry.created as the authoritative creation timestamp
 * for lead-time calculations, falling back to entry.updated for older records.
 * ───────────────────────────────────────────────────────────────────────────
 */

const FB_TOKEN_URL = 'https://api.freshbooks.com/auth/oauth/token';
const FB_API       = 'https://api.freshbooks.com';
const APP_URL      = 'https://planner.coradam.com';
const SUPER_ADMIN  = 'c.nocher@coradam.com';
const ALLOWED_DOMAIN = 'coradam.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      'Access-Control-Allow-Origin':  APP_URL,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/callback')                    return handleCallback(request, env, url, cors);
    if (url.pathname.startsWith('/api/analytics'))       return handleAnalytics(request, env, cors, url);
    if (url.pathname === '/api')                         return handleApi(request, env, cors);

    return new Response('Coradam Planner — Worker is running.', { headers: cors });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FRESHBOOKS — OAuth callback
// ═══════════════════════════════════════════════════════════════════════════

async function handleCallback(request, env, url, cors) {
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) return Response.redirect(`${APP_URL}?fb=error&msg=${encodeURIComponent(error)}`);
  if (!code)  return new Response('Missing code', { status: 400 });

  try {
    const callbackUrl = `${url.origin}/callback`;

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

    const meRes  = await fetch(`${FB_API}/auth/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData    = await meRes.json();
    const accountId = meData.response?.business_memberships?.[0]?.business?.account_id || null;

    await env.FB_TOKENS.put('data', JSON.stringify({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at:    Date.now() + tokenData.expires_in * 1000,
      account_id:    accountId,
      connected_at:  Date.now(),
    }));

    return Response.redirect(`${APP_URL}?fb=connected`);
  } catch (e) {
    console.error('[Coradam Worker] handleCallback error:', e);
    return Response.redirect(`${APP_URL}?fb=error&msg=${encodeURIComponent('OAuth connection failed. Please try again.')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FRESHBOOKS — API proxy (super admin only)
// ═══════════════════════════════════════════════════════════════════════════

async function handleApi(request, env, cors) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.replace('Bearer ', '').trim();
  if (!idToken) return jsonResponse({ error: 'Missing token' }, 401, cors);

  const user = await verifyFirebaseToken(idToken, env.FIREBASE_API_KEY);
  if (!user || user.email !== SUPER_ADMIN) {
    return jsonResponse({ error: 'Forbidden — super admin only' }, 403, cors);
  }

  const { action, payload } = await request.json();

  try {
    if (action === 'status') {
      const raw    = await env.FB_TOKENS.get('data');
      const stored = raw ? JSON.parse(raw) : null;
      return jsonResponse({
        connected:    !!stored,
        account_id:   stored?.account_id   || null,
        connected_at: stored?.connected_at || null,
      }, 200, cors);
    }

    const raw = await env.FB_TOKENS.get('data');
    if (!raw) throw new Error('Freshbooks not connected. Please connect first.');
    let stored = JSON.parse(raw);

    if (Date.now() >= stored.expires_at - 60_000) {
      stored = await refreshTokens(stored, env);
    }

    const authH = {
      Authorization:  `Bearer ${stored.access_token}`,
      'Content-Type': 'application/json',
    };

    if (action === 'listClients') {
      const page = payload?.page || 1;
      const r    = await fetch(
        `${FB_API}/accounting/account/${stored.account_id}/users/clients?vis_state=0&per_page=100&page=${page}`,
        { headers: authH }
      );
      return jsonResponse(await r.json(), 200, cors);
    }

    if (action === 'createEstimate') {
      const r = await fetch(
        `${FB_API}/accounting/account/${stored.account_id}/estimates/estimates`,
        { method: 'POST', headers: authH, body: JSON.stringify(payload) }
      );
      return jsonResponse(await r.json(), 200, cors);
    }

    throw new Error('Unknown action: ' + action);

  } catch (e) {
    console.error('[Coradam Worker] handleApi error:', e);
    return jsonResponse({ error: 'An internal error occurred. Please try again.' }, 500, cors);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS — Main router  (BE-07 through BE-18)
// ═══════════════════════════════════════════════════════════════════════════

async function handleAnalytics(request, env, cors, url) {
  // Analytics endpoints accept GET only
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  // Verify Firebase ID token — any @coradam.com user (matches DB read rules)
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.replace('Bearer ', '').trim();
  if (!idToken) return jsonResponse({ error: 'Missing Authorization token' }, 401, cors);

  const user = await verifyFirebaseToken(idToken, env.FIREBASE_API_KEY);
  if (!user || !user.email?.endsWith('@' + ALLOWED_DOMAIN)) {
    return jsonResponse({ error: 'Forbidden' }, 403, cors);
  }

  if (!env.FIREBASE_DATABASE_URL) {
    return jsonResponse({ error: 'FIREBASE_DATABASE_URL is not configured on this Worker' }, 500, cors);
  }

  const filters  = parseAnalyticsFilters(url);
  const pathname = url.pathname;

  // KV cache key for cache-eligible endpoints (BE-18)
  const cacheKey = 'analytics:' + pathname + '?' + url.searchParams.toString();

  // Try KV cache for overview (5 min TTL)
  if (pathname === '/api/analytics/overview' && env.ANALYTICS_CACHE) {
    const cached = await env.ANALYTICS_CACHE.get(cacheKey).catch(() => null);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
  }

  try {
    const db   = new FirebaseRTDB(env.FIREBASE_DATABASE_URL, idToken);
    const data = await loadFirebaseData(db);

    if (pathname === '/api/analytics/overview')               return analyticsOverview(data, filters, env, cacheKey, cors);
    if (pathname === '/api/analytics/lead-time-distribution') return analyticsLeadTimeDistribution(data, filters, cors);
    if (pathname === '/api/analytics/client-visibility')      return analyticsClientVisibility(data, filters, cors);
    if (pathname === '/api/analytics/controller-fill-rates')  return analyticsControllerFillRates(data, filters, cors);
    if (pathname === '/api/analytics/country-fill-rates')     return analyticsCountryFillRates(data, filters, cors);
    if (pathname === '/api/analytics/future-capacity')        return analyticsFutureCapacity(data, filters, cors);
    if (pathname === '/api/analytics/visibility-trend')       return analyticsVisibilityTrend(data, filters, cors);
    if (pathname === '/api/analytics/fill-rate-trend')        return analyticsFillRateTrend(data, filters, cors);
    if (pathname === '/api/analytics/client-segmentation')    return analyticsClientSegmentation(data, filters, cors);
    if (pathname === '/api/analytics/export')                 return analyticsExport(data, filters, url, cors);

    return jsonResponse({ error: 'Unknown analytics endpoint' }, 404, cors);

  } catch (e) {
    console.error('[Analytics]', e);
    return jsonResponse({ error: 'Analytics computation failed. Please try again.' }, 500, cors);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Firebase RTDB REST client
// ─────────────────────────────────────────────────────────────────────────

class FirebaseRTDB {
  constructor(databaseURL, idToken) {
    this.base  = databaseURL.replace(/\/$/, '');
    this.token = idToken;
  }
  async get(path) {
    const res = await fetch(`${this.base}/${path}.json?auth=${encodeURIComponent(this.token)}`);
    if (!res.ok) throw new Error(`Firebase GET ${path} → HTTP ${res.status}`);
    return res.json();
  }
}

async function loadFirebaseData(db) {
  const [rawEntries, rawAvail, rawUsers, rawClients] = await Promise.all([
    db.get('entries'),
    db.get('availability'),
    db.get('users'),
    db.get('clients'),
  ]);
  return {
    entries:      Object.values(rawEntries  || {}),
    availability: Object.values(rawAvail    || {}),
    users:        Object.values(rawUsers    || {}),
    clients:      Object.values(rawClients  || {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Date utilities
// ─────────────────────────────────────────────────────────────────────────

// Parse a YYYY-MM-DD string as UTC midnight timestamp
function parseDateUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// UTC timestamp → YYYY-MM-DD
function dateStrUTC(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function todayUTC()          { return dateStrUTC(Date.now()); }
function addDaysUTC(ts, n)   { return ts + n * 86400000; }

function currentMonthRange() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { from: dateStrUTC(Date.UTC(y, m, 1)), to: dateStrUTC(Date.UTC(y, m + 1, 0)) };
}
function prevMonthRange() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { from: dateStrUTC(Date.UTC(y, m - 1, 1)), to: dateStrUTC(Date.UTC(y, m, 0)) };
}

// ─────────────────────────────────────────────────────────────────────────
// BE-07 — Shared analytics filter layer
// ─────────────────────────────────────────────────────────────────────────
// Supported filters: date_from, date_to, country_code, client_id, factory,
//   controller_id, booking_status (ignored — all entries = confirmed),
//   compare, group_by, interval, sort_by, sort_dir, page, per_page,
//   top_n, windows (comma-separated day counts)

function parseAnalyticsFilters(url) {
  const p = url.searchParams;
  return {
    date_from:      p.get('date_from')  || null,
    date_to:        p.get('date_to')    || null,
    country_code:   p.get('country_code') || null,
    client_id:      p.get('client_id') || null,
    factory:        p.get('factory')   || null,
    controller_id:  p.get('controller_id') || null,
    // booking_status is accepted but ignored (all entries are treated as confirmed — BE-01)
    booking_status: p.get('booking_status') || null,
    compare:        p.get('compare') === 'true',
    group_by:       p.get('group_by')  || 'global',
    interval:       p.get('interval')  || 'month',
    sort_by:        p.get('sort_by')   || null,
    sort_dir:       (p.get('sort_dir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    page:           Math.max(1, parseInt(p.get('page')     || '1',   10)),
    per_page:       Math.min(200, Math.max(1, parseInt(p.get('per_page') || '50', 10))),
    top_n:          parseInt(p.get('top_n') || '0', 10) || 0,
    windows:        (p.get('windows') || '30,60,90,180').split(',').map(Number).filter(n => n > 0),
  };
}

// Returns true if the entry passes all applicable booking filters.
// Note: date range is applied here, so callers that want a different date
// window should pass a modified filter object (spread + override date_from/date_to).
function entryMatchesFilters(e, f) {
  if (f.date_from    && e.date       < f.date_from)      return false;
  if (f.date_to      && e.date       > f.date_to)        return false;
  if (f.country_code && e.userCountry !== f.country_code) return false;
  if (f.client_id    && e.clientId   !== f.client_id)    return false;
  if (f.factory      && e.factory    !== f.factory)      return false;
  if (f.controller_id && e.userId    !== f.controller_id) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// BE-04 — Entry helpers (half-day unit normalisation)
// ─────────────────────────────────────────────────────────────────────────
// Slot values in Firebase: 'Full Day' | 'Half Day AM' | 'Half Day PM'
// Analytics unit: every half-day = 1 unit; Full Day = 2 units

function entryHalfDayUnits(e) {
  return e.slot === 'Full Day' ? 2 : 1;
}

// Normalise slot to ['AM'] | ['PM'] | ['AM', 'PM']
function entrySlots(e) {
  if (e.slot === 'Full Day')    return ['AM', 'PM'];
  if (e.slot === 'Half Day AM') return ['AM'];
  return ['PM'];
}

// BE-01: lead time = service date – booking creation date (days, non-negative).
// Falls back to entry.updated for legacy rows missing entry.created.
function computeLeadTime(e) {
  const createdAt = e.created || e.updated;
  if (!createdAt || !e.date) return null;
  return Math.max(0, Math.floor((parseDateUTC(e.date) - createdAt) / 86400000));
}

// ─────────────────────────────────────────────────────────────────────────
// BE-02/03 — Availability expansion (normalise rules → per-slot records)
// ─────────────────────────────────────────────────────────────────────────
// Mirrors the expandAvail() logic in app.js but operates on UTC timestamps.
// Availability types in current data: 'available' | 'unavailable'.
// Additional ticket statuses (holiday, sick, off_day, blocked) are collapsed
// to 'unavailable' since the current UI only uses the binary model (BE-02 decision).

function expandAvailRule(rule, fromTs, toTs) {
  if (!rule.startDate) return [];
  const base  = parseDateUTC(rule.startDate);
  const end   = rule.endDate     ? parseDateUTC(rule.endDate)     : null;
  const mode  = rule.repeatMode  || 'none';
  const until = rule.repeatUntil ? parseDateUTC(rule.repeatUntil) : toTs;

  const dateTs = [];

  if (mode === 'none') {
    if (end) {
      let d = Math.max(base, fromTs);
      const stop = Math.min(end, toTs);
      while (d <= stop) { dateTs.push(d); d += 86400000; }
    } else {
      if (base >= fromTs && base <= toTs) dateTs.push(base);
    }
  } else if (mode === 'weekly') {
    let d = base;
    while (d <= Math.min(until, toTs)) {
      if (d >= fromTs) dateTs.push(d);
      d += 7 * 86400000;
    }
  } else if (mode === 'monthly') {
    const dt = new Date(base);
    let y = dt.getUTCFullYear(), m = dt.getUTCMonth(), day = dt.getUTCDate();
    while (true) {
      const ts = Date.UTC(y, m, day);
      if (ts > Math.min(until, toTs)) break;
      if (ts >= fromTs) dateTs.push(ts);
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }

  const records = [];
  for (const d of dateTs) {
    const dateS   = dateStrUTC(d);
    const slotArr = rule.slot === 'Full Day'
      ? ['AM', 'PM']
      : [rule.slot === 'Half Day AM' ? 'AM' : 'PM'];
    for (const slot of slotArr) {
      records.push({
        controller_id: rule.userId,
        date:          dateS,
        slot,
        avail_type:    rule.type === 'available' ? 'available' : 'unavailable',
      });
    }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────
// BE-05 — Build availability analytics matrix for a date range
// ─────────────────────────────────────────────────────────────────────────
// Returns a Map<key, record> where key = "controllerId|date|slot".
// Each record includes available_capacity_units and booked_units.
// Entries (bookings) are overlaid to mark slots as 'booked' (BE-03).
// Dimension filters (country_code, controller_id) are respected; date range
// filtering is done via the explicit fromDate/toDate parameters.

function buildAvailMatrix(availability, entries, users, fromDate, toDate, filters) {
  const fromTs  = parseDateUTC(fromDate);
  const toTs    = parseDateUTC(toDate);
  const userMap = {};
  for (const u of users) userMap[u.uid] = u;

  // Derived filters for this function (only dimensional, not date-based)
  const countryFilter     = filters.country_code  || null;
  const controllerFilter  = filters.controller_id || null;

  const matrix = new Map();

  // 1. Expand availability rules → individual (controller, date, slot) records
  for (const rule of availability) {
    if (!rule.userId || !rule.startDate) continue;
    const u = userMap[rule.userId];
    if (!u) continue;
    if (countryFilter    && u.country  !== countryFilter)    continue;
    if (controllerFilter && rule.userId !== controllerFilter) continue;

    const records = expandAvailRule(rule, fromTs, toTs);
    for (const r of records) {
      const key = `${r.controller_id}|${r.date}|${r.slot}`;
      // Later rules for the same slot override earlier ones
      matrix.set(key, {
        controller_id:   r.controller_id,
        controller_name: u.name,
        country_code:    u.country || '',
        date:            r.date,
        slot:            r.slot,
        status:          r.avail_type,
      });
    }
  }

  // 2. Overlay entries: any booked entry marks the slot as 'booked' (BE-03)
  for (const e of entries) {
    if (e.date < fromDate || e.date > toDate) continue;
    if (countryFilter    && e.userCountry !== countryFilter)   continue;
    if (controllerFilter && e.userId      !== controllerFilter) continue;

    const u = userMap[e.userId];
    for (const slot of entrySlots(e)) {
      const key = `${e.userId}|${e.date}|${slot}`;
      if (matrix.has(key)) {
        matrix.get(key).status = 'booked';
      } else {
        matrix.set(key, {
          controller_id:   e.userId,
          controller_name: e.userName  || (u?.name  || ''),
          country_code:    e.userCountry || (u?.country || ''),
          date:            e.date,
          slot,
          status:          'booked',
        });
      }
    }
  }

  // 3. Compute analytics units
  for (const [, r] of matrix) {
    r.available_capacity_units = (r.status === 'available' || r.status === 'booked') ? 1 : 0;
    r.booked_units             = r.status === 'booked' ? 1 : 0;
  }

  return matrix;
}

function computeFillRateFromMatrix(matrix) {
  let totalCap = 0, totalBooked = 0;
  for (const [, r] of matrix) {
    totalCap    += r.available_capacity_units;
    totalBooked += r.booked_units;
  }
  if (!totalCap) return null;
  return Math.round((totalBooked / totalCap) * 1000) / 10; // one decimal percentage
}

// Pagination helper — sorts and slices a row array, returns {rows, total, page, per_page}
function paginate(rows, sortBy, sortDir, page, perPage) {
  if (sortBy) {
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sortBy] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      const bv = b[sortBy] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      return dir * (av < bv ? -1 : av > bv ? 1 : 0);
    });
  }
  const total  = rows.length;
  const offset = (page - 1) * perPage;
  return { rows: rows.slice(offset, offset + perPage), total, page, per_page: perPage };
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-08 — GET /api/analytics/overview
// Returns KPI cards: booked next 30/90 days, avg lead time, avg visibility
// horizon, fill rate this month, fill rate previous month.
// ═══════════════════════════════════════════════════════════════════════════

async function analyticsOverview(data, filters, env, cacheKey, cors) {
  const { entries, availability, users } = data;
  const todayStr = todayUTC();
  const in30     = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));
  const in90     = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 90));

  // Base filtered set (no date restriction from caller — we apply our own windows)
  const baseFilters = { ...filters, date_from: null, date_to: null };

  // Booked half-days in next 30 / 90 days
  const booked30 = entries
    .filter(e => entryMatchesFilters(e, { ...baseFilters, date_from: todayStr, date_to: in30 }))
    .reduce((s, e) => s + entryHalfDayUnits(e), 0);
  const booked90 = entries
    .filter(e => entryMatchesFilters(e, { ...baseFilters, date_from: todayStr, date_to: in90 }))
    .reduce((s, e) => s + entryHalfDayUnits(e), 0);

  // Average booking lead time
  const withLead = entries.filter(e => entryMatchesFilters(e, baseFilters) && computeLeadTime(e) !== null);
  const avgLeadTime = withLead.length
    ? Math.round(withLead.reduce((s, e) => s + computeLeadTime(e), 0) / withLead.length)
    : null;

  // Average client visibility horizon (days from today to each client's last future booking)
  const clientLastDate = {};
  for (const e of entries) {
    if (!entryMatchesFilters(e, baseFilters) || !e.clientId || e.date <= todayStr) continue;
    if (!clientLastDate[e.clientId] || e.date > clientLastDate[e.clientId]) {
      clientLastDate[e.clientId] = e.date;
    }
  }
  const horizons = Object.values(clientLastDate)
    .map(d => Math.max(0, Math.floor((parseDateUTC(d) - parseDateUTC(todayStr)) / 86400000)));
  const avgVisibility = horizons.length
    ? Math.round(horizons.reduce((s, h) => s + h, 0) / horizons.length)
    : null;

  // Fill rates — this month and previous month
  const thisMonth = currentMonthRange();
  const prevMonth = prevMonthRange();
  const matThis   = buildAvailMatrix(availability, entries, users, thisMonth.from, thisMonth.to, baseFilters);
  const matPrev   = buildAvailMatrix(availability, entries, users, prevMonth.from, prevMonth.to, baseFilters);
  const fillRateThis = computeFillRateFromMatrix(matThis);
  const fillRatePrev = computeFillRateFromMatrix(matPrev);

  const result = {
    booked_next_30_half_days:         booked30,
    booked_next_90_half_days:         booked90,
    avg_booking_lead_time_days:       avgLeadTime,
    avg_client_visibility_horizon_days: avgVisibility,
    fill_rate_this_month:             fillRateThis,
    fill_rate_previous_month:         fillRatePrev,
    delta_fill_rate:                  (fillRateThis !== null && fillRatePrev !== null)
                                        ? Math.round((fillRateThis - fillRatePrev) * 10) / 10
                                        : null,
    period_current:                   thisMonth,
    period_previous:                  prevMonth,
    computed_at:                      new Date().toISOString(),
  };

  // Cache for 5 minutes (BE-18)
  if (env.ANALYTICS_CACHE) {
    env.ANALYTICS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 }).catch(() => {});
  }

  return jsonResponse(result, 200, { ...cors, 'Cache-Control': 'private, max-age=300' });
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-09 — GET /api/analytics/lead-time-distribution
// Returns booking counts grouped into anticipation buckets.
// Query params: group_by=global|client|country
// ═══════════════════════════════════════════════════════════════════════════

function analyticsLeadTimeDistribution(data, filters, cors) {
  const { entries } = data;
  const BUCKETS = [
    { label: '0–3',   min: 0,  max: 3   },
    { label: '4–7',   min: 4,  max: 7   },
    { label: '8–14',  min: 8,  max: 14  },
    { label: '15–30', min: 15, max: 30  },
    { label: '31–60', min: 31, max: 60  },
    { label: '61–90', min: 61, max: 90  },
    { label: '91+',   min: 91, max: Infinity },
  ];

  const groupBy = filters.group_by || 'global';
  const grouped = {}; // group_key → bucket_label → half-day count

  for (const e of entries) {
    if (!entryMatchesFilters(e, filters)) continue;
    const lt = computeLeadTime(e);
    if (lt === null) continue;
    const bucket = BUCKETS.find(b => lt >= b.min && lt <= b.max)?.label || '91+';
    const units  = entryHalfDayUnits(e);

    let key;
    if      (groupBy === 'client')  key = e.clientId    || 'unknown';
    else if (groupBy === 'country') key = e.userCountry || 'unknown';
    else                            key = 'global';

    if (!grouped[key]) grouped[key] = {};
    grouped[key][bucket] = (grouped[key][bucket] || 0) + units;
  }

  const labels = BUCKETS.map(b => b.label);

  if (groupBy === 'global') {
    const counts = grouped['global'] || {};
    return jsonResponse({
      buckets:  labels.map(l => ({ label: l, count: counts[l] || 0 })),
      group_by: groupBy,
    }, 200, cors);
  }

  const groups = Object.entries(grouped).map(([key, counts]) => ({
    group:   key,
    buckets: labels.map(l => ({ label: l, count: counts[l] || 0 })),
  }));

  return jsonResponse({ groups, group_by: groupBy, bucket_labels: labels }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-10 — GET /api/analytics/client-visibility
// Returns ranked client visibility metrics.
// Query params: sort_by, sort_dir, page, per_page, + standard filters
// ═══════════════════════════════════════════════════════════════════════════

function analyticsClientVisibility(data, filters, cors) {
  const { entries, clients } = data;
  const todayStr  = todayUTC();
  const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));
  const in90      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 90));
  const thirtyAgo = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), -30));

  const clientMap = {};
  for (const c of clients) if (c.id) clientMap[c.id] = c;

  const baseF = { ...filters, date_from: null, date_to: null };

  // Accumulate per-client metrics across all entries
  const metrics = {};
  for (const e of entries) {
    if (!entryMatchesFilters(e, baseF) || !e.clientId) continue;
    if (!metrics[e.clientId]) {
      metrics[e.clientId] = {
        client_id:   e.clientId,
        client_name: e.clientName || clientMap[e.clientId]?.name || e.clientId,
        lastFuture:  null,
        future30:    0,
        future90:    0,
        leadTimes:   [],
      };
    }
    const m = metrics[e.clientId];
    if (e.date > todayStr) {
      if (!m.lastFuture || e.date > m.lastFuture) m.lastFuture = e.date;
      const units = entryHalfDayUnits(e);
      if (e.date <= in30) m.future30 += units;
      if (e.date <= in90) m.future90 += units;
    }
    const lt = computeLeadTime(e);
    if (lt !== null) m.leadTimes.push(lt);
  }

  // Previous-period horizon: compute visibility horizon as if today were 30 days ago
  // (approximates the snapshot delta without a stored snapshot table — BE-06 live-query approach)
  const prevHorizons = {};
  for (const e of entries) {
    if (!e.clientId || e.date <= thirtyAgo) continue;
    if (!prevHorizons[e.clientId] || e.date > prevHorizons[e.clientId]) {
      prevHorizons[e.clientId] = e.date;
    }
  }

  const rows = Object.values(metrics).map(m => {
    const horizonDays = m.lastFuture
      ? Math.max(0, Math.floor((parseDateUTC(m.lastFuture) - parseDateUTC(todayStr)) / 86400000))
      : 0;
    const prevLastDate    = prevHorizons[m.client_id];
    const prevHorizonDays = prevLastDate
      ? Math.max(0, Math.floor((parseDateUTC(prevLastDate) - parseDateUTC(thirtyAgo)) / 86400000))
      : 0;
    const avgLeadTime = m.leadTimes.length
      ? Math.round(m.leadTimes.reduce((s, v) => s + v, 0) / m.leadTimes.length)
      : null;

    const delta = horizonDays - prevHorizonDays;
    const trendStatus = delta > 7 ? 'improving' : delta < -7 ? 'declining' : 'stable';

    return {
      client_id:                   m.client_id,
      client_name:                 m.client_name,
      booked_next_30_half_days:    m.future30,
      booked_next_90_half_days:    m.future90,
      last_future_service_date:    m.lastFuture,
      visibility_horizon_days:     horizonDays,
      visibility_horizon_delta_days: delta,
      avg_booking_lead_time_days:  avgLeadTime,
      trend_status:                trendStatus,
    };
  });

  const paged = paginate(
    rows,
    filters.sort_by || 'visibility_horizon_days',
    filters.sort_dir,
    filters.page,
    filters.per_page,
  );
  return jsonResponse(paged, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-11 — GET /api/analytics/controller-fill-rates
// Returns fill rate metrics per controller.
// ═══════════════════════════════════════════════════════════════════════════

function analyticsControllerFillRates(data, filters, cors) {
  const { entries, availability, users } = data;
  const thisMonth = currentMonthRange();
  const prevMonth = prevMonthRange();
  const todayStr  = todayUTC();
  const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));

  const dimFilters = { ...filters, date_from: null, date_to: null };

  const matThis  = buildAvailMatrix(availability, entries, users, thisMonth.from, thisMonth.to, dimFilters);
  const matPrev  = buildAvailMatrix(availability, entries, users, prevMonth.from, prevMonth.to, dimFilters);
  const matNext30 = buildAvailMatrix(availability, entries, users, todayStr, in30, dimFilters);

  // Aggregate by controller
  const aggByCtrl = mat => {
    const s = {};
    for (const [, r] of mat) {
      if (!s[r.controller_id]) s[r.controller_id] = { cap: 0, booked: 0 };
      s[r.controller_id].cap    += r.available_capacity_units;
      s[r.controller_id].booked += r.booked_units;
    }
    return s;
  };

  const sThis  = aggByCtrl(matThis);
  const sPrev  = aggByCtrl(matPrev);
  const sNext  = aggByCtrl(matNext30);

  const bookable = users.filter(u => (u.role === 'controller' || u.role === 'super_admin') && u.active);

  const rows = bookable
    .filter(u => {
      if (filters.country_code  && u.country !== filters.country_code)  return false;
      if (filters.controller_id && u.uid     !== filters.controller_id) return false;
      return true;
    })
    .map(u => {
      const cur  = sThis[u.uid]  || { cap: 0, booked: 0 };
      const prev = sPrev[u.uid]  || { cap: 0, booked: 0 };
      const next = sNext[u.uid]  || { cap: 0, booked: 0 };

      const fillRate     = cur.cap  ? Math.round((cur.booked  / cur.cap)  * 1000) / 10 : null;
      const fillRatePrev = prev.cap ? Math.round((prev.booked / prev.cap) * 1000) / 10 : null;
      const projFill     = next.cap ? Math.round((next.booked / next.cap) * 1000) / 10 : null;
      const delta        = (fillRate !== null && fillRatePrev !== null)
                            ? Math.round((fillRate - fillRatePrev) * 10) / 10 : null;

      const utilizationStatus = fillRate === null ? 'unknown'
        : fillRate >= 90 ? 'full'
        : fillRate >= 60 ? 'high'
        : fillRate >= 30 ? 'medium'
        : 'low';

      return {
        controller_id:               u.uid,
        controller_name:             u.name,
        country_code:                u.country || '',
        available_half_days:         cur.cap,
        booked_half_days:            cur.booked,
        fill_rate:                   fillRate,
        previous_month_fill_rate:    fillRatePrev,
        delta_fill_rate:             delta,
        projected_fill_rate_next_30: projFill,
        utilization_status:          utilizationStatus,
      };
    });

  const paged = paginate(rows, filters.sort_by || 'fill_rate', filters.sort_dir, filters.page, filters.per_page);
  return jsonResponse(paged, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-12 — GET /api/analytics/country-fill-rates
// Returns fill rate aggregates by country.
// ═══════════════════════════════════════════════════════════════════════════

function analyticsCountryFillRates(data, filters, cors) {
  const { entries, availability, users } = data;
  const thisMonth = currentMonthRange();
  const prevMonth = prevMonthRange();
  const todayStr  = todayUTC();
  const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));

  // Build matrices without country filter so all countries appear
  const noCountryF = { ...filters, country_code: null, date_from: null, date_to: null };
  const matThis   = buildAvailMatrix(availability, entries, users, thisMonth.from, thisMonth.to, noCountryF);
  const matPrev   = buildAvailMatrix(availability, entries, users, prevMonth.from, prevMonth.to, noCountryF);
  const matNext30 = buildAvailMatrix(availability, entries, users, todayStr, in30, noCountryF);

  const agg = (mat, country) => {
    let cap = 0, booked = 0;
    for (const [, r] of mat) {
      if (r.country_code !== country) continue;
      cap    += r.available_capacity_units;
      booked += r.booked_units;
    }
    return { cap, booked };
  };

  const countries = [...new Set(users.map(u => u.country).filter(Boolean))].sort();
  const rows = countries.map(country => {
    const cur  = agg(matThis, country);
    const prev = agg(matPrev, country);
    const next = agg(matNext30, country);
    return {
      country_code:                   country,
      fill_rate_current:              cur.cap  ? Math.round((cur.booked  / cur.cap)  * 1000) / 10 : null,
      fill_rate_previous:             prev.cap ? Math.round((prev.booked / prev.cap) * 1000) / 10 : null,
      projected_fill_rate_next_30:    next.cap ? Math.round((next.booked / next.cap) * 1000) / 10 : null,
    };
  });

  return jsonResponse({ rows, period_current: thisMonth, period_previous: prevMonth }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-13 — GET /api/analytics/future-capacity
// Returns available, booked, and remaining capacity for configurable windows.
// Query params: windows=30,60,90,180  group_by=global|country
// ═══════════════════════════════════════════════════════════════════════════

function analyticsFutureCapacity(data, filters, cors) {
  const { entries, availability, users } = data;
  const todayStr = todayUTC();
  const windows  = filters.windows.length ? filters.windows : [30, 60, 90, 180];
  const groupBy  = filters.group_by || 'global';

  const dimFilters = { ...filters, date_from: null, date_to: null };
  const result = {};

  for (const w of windows) {
    const toDate = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), w));

    if (groupBy === 'country') {
      result[`next_${w}`] = {};
      const countries = [...new Set(users.map(u => u.country).filter(Boolean))].sort();
      for (const country of countries) {
        const filt = { ...dimFilters, country_code: country };
        const mat  = buildAvailMatrix(availability, entries, users, todayStr, toDate, filt);
        let cap = 0, booked = 0;
        for (const [, r] of mat) { cap += r.available_capacity_units; booked += r.booked_units; }
        result[`next_${w}`][country] = {
          available_half_days:  cap,
          booked_half_days:     booked,
          remaining_half_days:  cap - booked,
          projected_fill_rate:  cap ? Math.round((booked / cap) * 1000) / 10 : null,
        };
      }
    } else {
      const mat = buildAvailMatrix(availability, entries, users, todayStr, toDate, dimFilters);
      let cap = 0, booked = 0;
      for (const [, r] of mat) { cap += r.available_capacity_units; booked += r.booked_units; }
      result[`next_${w}`] = {
        available_half_days:  cap,
        booked_half_days:     booked,
        remaining_half_days:  cap - booked,
        projected_fill_rate:  cap ? Math.round((booked / cap) * 1000) / 10 : null,
      };
    }
  }

  return jsonResponse({ windows, group_by: groupBy, data: result, as_of: todayStr }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-14 — GET /api/analytics/visibility-trend
// Returns time series of visibility horizon.
// Query params: group_by=global|client|country  interval=day|week|month
// Note: since we have no daily snapshots, we reconstruct the trend from
// entry.created timestamps (when each booking became known).
// ═══════════════════════════════════════════════════════════════════════════

function analyticsVisibilityTrend(data, filters, cors) {
  const { entries, users } = data;
  const todayStr  = todayUTC();
  const groupBy   = filters.group_by || 'global';
  const interval  = filters.interval || 'month';

  // Determine lookback window
  const fromStr = filters.date_from || dateStrUTC(addDaysUTC(parseDateUTC(todayStr), -365));
  const toStr   = filters.date_to   || todayStr;

  // Generate time buckets
  const buckets = buildTimeBuckets(fromStr, toStr, interval);
  if (!buckets.length) return jsonResponse({ series: [], group_by: groupBy, interval }, 200, cors);

  const baseF = { ...filters, date_from: null, date_to: null };

  const computeHorizon = (bucketDateStr, filteredEntries) => {
    const bucketTs   = parseDateUTC(bucketDateStr);
    // Entries that were already booked as of this bucket date
    const known      = filteredEntries.filter(e => {
      const created = e.created || e.updated;
      return created && created <= bucketTs;
    });
    const maxDate = known
      .filter(e => e.date > bucketDateStr)
      .reduce((max, e) => (!max || e.date > max ? e.date : max), null);
    return maxDate ? Math.max(0, Math.floor((parseDateUTC(maxDate) - bucketTs) / 86400000)) : 0;
  };

  if (groupBy === 'global') {
    const fEntries = entries.filter(e => entryMatchesFilters(e, baseF));
    const series   = buckets.map(b => ({
      date:                    b,
      visibility_horizon_days: computeHorizon(b, fEntries),
    }));
    return jsonResponse({ series, group_by: groupBy, interval }, 200, cors);
  }

  if (groupBy === 'client') {
    const topN      = filters.top_n > 0 ? filters.top_n : 10;
    const clientIds = [...new Set(entries.filter(e => e.clientId).map(e => e.clientId))];
    // Rank by booking volume to limit lines to top N
    const volume = {};
    for (const e of entries) if (e.clientId) volume[e.clientId] = (volume[e.clientId] || 0) + 1;
    const topClients = clientIds
      .sort((a, b) => (volume[b] || 0) - (volume[a] || 0))
      .slice(0, topN);

    const groups = topClients.map(clientId => {
      const clientName = entries.find(e => e.clientId === clientId)?.clientName || clientId;
      const cEntries   = entries.filter(e => e.clientId === clientId);
      const series     = buckets.map(b => ({
        date:                    b,
        visibility_horizon_days: computeHorizon(b, cEntries),
      }));
      return { client_id: clientId, client_name: clientName, series };
    });

    return jsonResponse({ groups, group_by: groupBy, interval, top_n: topN }, 200, cors);
  }

  if (groupBy === 'country') {
    const countries = [...new Set(users.map(u => u.country).filter(Boolean))].sort();
    const groups = countries.map(country => {
      const cEntries = entries.filter(e => e.userCountry === country);
      const series   = buckets.map(b => ({
        date:                    b,
        visibility_horizon_days: computeHorizon(b, cEntries),
      }));
      return { country_code: country, series };
    });
    return jsonResponse({ groups, group_by: groupBy, interval }, 200, cors);
  }

  return jsonResponse({ series: [], group_by: groupBy, interval }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-15 — GET /api/analytics/fill-rate-trend
// Returns fill rate trends over time.
// Query params: group_by=controller|country|global  interval=week|month
// ═══════════════════════════════════════════════════════════════════════════

function analyticsFillRateTrend(data, filters, cors) {
  const { entries, availability, users } = data;
  const todayStr = todayUTC();
  const groupBy  = filters.group_by || 'global';
  const interval = filters.interval === 'week' ? 'week' : 'month';

  const fromStr = filters.date_from || dateStrUTC(addDaysUTC(parseDateUTC(todayStr), -365));
  const toStr   = filters.date_to   || todayStr;

  // Build period buckets with explicit start/end dates
  const periods = buildPeriodBuckets(fromStr, toStr, interval);
  if (!periods.length) return jsonResponse({ series: [], group_by: groupBy, interval }, 200, cors);

  const dimF = { ...filters, date_from: null, date_to: null };

  if (groupBy === 'global') {
    const series = periods.map(p => {
      const mat = buildAvailMatrix(availability, entries, users, p.from, p.to, dimF);
      return { date: p.label, fill_rate: computeFillRateFromMatrix(mat) };
    });
    return jsonResponse({ series, group_by: groupBy, interval }, 200, cors);
  }

  if (groupBy === 'country') {
    const countries = [...new Set(users.map(u => u.country).filter(Boolean))].sort();
    const groups    = countries.map(country => {
      const filt   = { ...dimF, country_code: country };
      const series = periods.map(p => {
        const mat = buildAvailMatrix(availability, entries, users, p.from, p.to, filt);
        return { date: p.label, fill_rate: computeFillRateFromMatrix(mat) };
      });
      return { country_code: country, series };
    });
    // Period logic is consistent with overview cards (uses same buildAvailMatrix)
    return jsonResponse({ groups, group_by: groupBy, interval }, 200, cors);
  }

  if (groupBy === 'controller') {
    const bookable = users.filter(u => (u.role === 'controller' || u.role === 'super_admin') && u.active);
    const groups   = bookable
      .filter(u => !filters.country_code || u.country === filters.country_code)
      .map(u => {
        const filt   = { ...dimF, controller_id: u.uid };
        const series = periods.map(p => {
          const mat = buildAvailMatrix(availability, entries, users, p.from, p.to, filt);
          return { date: p.label, fill_rate: computeFillRateFromMatrix(mat) };
        });
        return { controller_id: u.uid, controller_name: u.name, country_code: u.country || '', series };
      });
    return jsonResponse({ groups, group_by: groupBy, interval }, 200, cors);
  }

  return jsonResponse({ series: [], group_by: groupBy, interval }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-16 — GET /api/analytics/client-segmentation
// Classifies clients by average booking lead time.
// Segments: short_notice (<14 days) | medium_horizon (14–45) | long_horizon (>45)
// ═══════════════════════════════════════════════════════════════════════════

function analyticsClientSegmentation(data, filters, cors) {
  const { entries } = data;

  const clientData = {}; // clientId → { name, leadTimes[], halfDays }

  for (const e of entries) {
    if (!entryMatchesFilters(e, filters) || !e.clientId) continue;
    const lt = computeLeadTime(e);
    if (lt === null) continue;
    if (!clientData[e.clientId]) {
      clientData[e.clientId] = { name: e.clientName || e.clientId, leadTimes: [], halfDays: 0 };
    }
    clientData[e.clientId].leadTimes.push(lt);
    clientData[e.clientId].halfDays += entryHalfDayUnits(e);
  }

  const SEGMENTS = [
    { key: 'short_notice',    label: 'Short Notice',    min: 0,  max: 13 },
    { key: 'medium_horizon',  label: 'Medium Horizon',  min: 14, max: 45 },
    { key: 'long_horizon',    label: 'Long Horizon',    min: 46, max: Infinity },
  ];

  const bins = {};
  for (const s of SEGMENTS) bins[s.key] = { count: 0, halfDays: 0, clients: [] };

  for (const [clientId, cd] of Object.entries(clientData)) {
    const avg = cd.leadTimes.reduce((s, v) => s + v, 0) / cd.leadTimes.length;
    const seg = SEGMENTS.find(s => avg >= s.min && avg <= s.max) || SEGMENTS[2];
    bins[seg.key].count++;
    bins[seg.key].halfDays += cd.halfDays;
    bins[seg.key].clients.push({
      client_id:              clientId,
      client_name:            cd.name,
      avg_lead_time_days:     Math.round(avg),
      booked_half_days:       cd.halfDays,
    });
  }

  const segments = SEGMENTS.map(s => ({
    segment:               s.key,
    label:                 s.label,
    lead_time_range:       `${s.min}–${s.max === Infinity ? '∞' : s.max} days`,
    client_count:          bins[s.key].count,
    booked_half_days:      bins[s.key].halfDays,
    clients:               bins[s.key].clients.sort((a, b) => b.avg_lead_time_days - a.avg_lead_time_days),
  }));

  return jsonResponse({ segments, computed_at: new Date().toISOString() }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════════════════
// BE-17 — GET /api/analytics/export
// CSV export for key analytics tables.
// Query params: type=client-visibility|controller-fill-rates|country-fill-rates
//               + all standard filters
// ═══════════════════════════════════════════════════════════════════════════

function analyticsExport(data, filters, url, cors) {
  const exportType  = url.searchParams.get('type') || 'client-visibility';
  const { entries, availability, users } = data;
  const todayStr    = todayUTC();
  const generatedAt = new Date().toISOString();

  let rows = [];
  let filename = 'analytics-export';

  if (exportType === 'client-visibility') {
    filename = 'client-visibility';
    rows.push(['Client Name', 'Booked Next 30 (Half Days)', 'Booked Next 90 (Half Days)',
               'Last Future Service Date', 'Visibility Horizon (Days)',
               'Visibility Horizon Delta (Days)', 'Avg Lead Time (Days)', 'Trend Status']);

    // Reuse client visibility logic
    const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));
    const in90      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 90));
    const thirtyAgo = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), -30));
    const baseF     = { ...filters, date_from: null, date_to: null };

    const metrics = {};
    for (const e of entries) {
      if (!entryMatchesFilters(e, baseF) || !e.clientId) continue;
      if (!metrics[e.clientId]) {
        metrics[e.clientId] = { name: e.clientName || e.clientId, lastFuture: null, f30: 0, f90: 0, leadTimes: [] };
      }
      const m = metrics[e.clientId];
      if (e.date > todayStr) {
        if (!m.lastFuture || e.date > m.lastFuture) m.lastFuture = e.date;
        const units = entryHalfDayUnits(e);
        if (e.date <= in30) m.f30 += units;
        if (e.date <= in90) m.f90 += units;
      }
      const lt = computeLeadTime(e);
      if (lt !== null) m.leadTimes.push(lt);
    }
    const prevHorizons = {};
    for (const e of entries) {
      if (!e.clientId || e.date <= thirtyAgo) continue;
      if (!prevHorizons[e.clientId] || e.date > prevHorizons[e.clientId]) prevHorizons[e.clientId] = e.date;
    }

    for (const [clientId, m] of Object.entries(metrics)) {
      const h     = m.lastFuture ? Math.max(0, Math.floor((parseDateUTC(m.lastFuture) - parseDateUTC(todayStr)) / 86400000)) : 0;
      const ph    = prevHorizons[clientId] ? Math.max(0, Math.floor((parseDateUTC(prevHorizons[clientId]) - parseDateUTC(thirtyAgo)) / 86400000)) : 0;
      const delta = h - ph;
      const avgLt = m.leadTimes.length ? Math.round(m.leadTimes.reduce((s, v) => s + v, 0) / m.leadTimes.length) : '';
      const trend = delta > 7 ? 'improving' : delta < -7 ? 'declining' : 'stable';
      rows.push([m.name, m.f30, m.f90, m.lastFuture || '', h, delta, avgLt, trend]);
    }

  } else if (exportType === 'controller-fill-rates') {
    filename = 'controller-fill-rates';
    rows.push(['Controller Name', 'Country', 'Available Half Days', 'Booked Half Days',
               'Fill Rate (%)', 'Prev Month Fill Rate (%)', 'Delta (%)',
               'Projected Next 30 (%)', 'Utilization Status']);

    const thisMonth = currentMonthRange();
    const prevMonth = prevMonthRange();
    const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));
    const dimF      = { ...filters, date_from: null, date_to: null };

    const matThis  = buildAvailMatrix(availability, entries, users, thisMonth.from, thisMonth.to, dimF);
    const matPrev  = buildAvailMatrix(availability, entries, users, prevMonth.from, prevMonth.to, dimF);
    const matNext  = buildAvailMatrix(availability, entries, users, todayStr, in30, dimF);

    const agg = mat => {
      const s = {};
      for (const [, r] of mat) {
        if (!s[r.controller_id]) s[r.controller_id] = { name: r.controller_name, country: r.country_code, cap: 0, booked: 0 };
        s[r.controller_id].cap    += r.available_capacity_units;
        s[r.controller_id].booked += r.booked_units;
      }
      return s;
    };

    const sThis = agg(matThis), sPrev = agg(matPrev), sNext = agg(matNext);
    for (const [uid, cur] of Object.entries(sThis)) {
      const prev = sPrev[uid] || { cap: 0, booked: 0 };
      const next = sNext[uid] || { cap: 0, booked: 0 };
      const fr   = cur.cap  ? Math.round((cur.booked  / cur.cap)  * 1000) / 10 : '';
      const frP  = prev.cap ? Math.round((prev.booked / prev.cap) * 1000) / 10 : '';
      const frN  = next.cap ? Math.round((next.booked / next.cap) * 1000) / 10 : '';
      const delta = (fr !== '' && frP !== '') ? Math.round((fr - frP) * 10) / 10 : '';
      const status = fr === '' ? 'unknown' : fr >= 90 ? 'full' : fr >= 60 ? 'high' : fr >= 30 ? 'medium' : 'low';
      rows.push([cur.name, cur.country, cur.cap, cur.booked, fr, frP, delta, frN, status]);
    }

  } else if (exportType === 'country-fill-rates') {
    filename = 'country-fill-rates';
    rows.push(['Country', 'Fill Rate Current (%)', 'Fill Rate Previous (%)', 'Projected Next 30 (%)']);

    const thisMonth = currentMonthRange();
    const prevMonth = prevMonthRange();
    const in30      = dateStrUTC(addDaysUTC(parseDateUTC(todayStr), 30));
    const noCountryF = { ...filters, country_code: null, date_from: null, date_to: null };

    const matThis  = buildAvailMatrix(availability, entries, users, thisMonth.from, thisMonth.to, noCountryF);
    const matPrev  = buildAvailMatrix(availability, entries, users, prevMonth.from, prevMonth.to, noCountryF);
    const matNext  = buildAvailMatrix(availability, entries, users, todayStr, in30, noCountryF);
    const countries = [...new Set(users.map(u => u.country).filter(Boolean))].sort();

    for (const country of countries) {
      const agg = mat => {
        let cap = 0, booked = 0;
        for (const [, r] of mat) { if (r.country_code !== country) continue; cap += r.available_capacity_units; booked += r.booked_units; }
        return { cap, booked };
      };
      const cur = agg(matThis), prev = agg(matPrev), next = agg(matNext);
      rows.push([
        country,
        cur.cap  ? Math.round((cur.booked  / cur.cap)  * 1000) / 10 : '',
        prev.cap ? Math.round((prev.booked / prev.cap) * 1000) / 10 : '',
        next.cap ? Math.round((next.booked / next.cap) * 1000) / 10 : '',
      ]);
    }
  } else {
    return jsonResponse({ error: `Unknown export type: ${exportType}. Use client-visibility, controller-fill-rates, or country-fill-rates.` }, 400, cors);
  }

  // Append generation timestamp (BE-17: export includes timestamp)
  rows.push([]);
  rows.push([`Generated at: ${generatedAt}`]);

  const csv = rows
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  return new Response(csv, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}-${generatedAt.split('T')[0]}.csv"`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Time bucket helpers
// ─────────────────────────────────────────────────────────────────────────

// Returns an array of YYYY-MM-DD label strings for each bucket start
function buildTimeBuckets(fromStr, toStr, interval) {
  const buckets = [];
  let cur = parseDateUTC(fromStr);
  const to = parseDateUTC(toStr);
  while (cur <= to) {
    buckets.push(dateStrUTC(cur));
    if      (interval === 'day')  cur = addDaysUTC(cur, 1);
    else if (interval === 'week') cur = addDaysUTC(cur, 7);
    else { // month
      const d = new Date(cur);
      cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
  return buckets;
}

// Returns [{from, to, label}] periods, where to is end-of-period (inclusive)
function buildPeriodBuckets(fromStr, toStr, interval) {
  const periods = [];
  let cur = parseDateUTC(fromStr);
  const to = parseDateUTC(toStr);
  while (cur <= to) {
    const d = new Date(cur);
    let periodEnd, label;
    if (interval === 'week') {
      periodEnd = Math.min(addDaysUTC(cur, 6), to);
      label     = dateStrUTC(cur);
    } else { // month
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      periodEnd = Math.min(Date.UTC(y, m + 1, 0), to);
      label     = `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    periods.push({ from: dateStrUTC(cur), to: dateStrUTC(periodEnd), label });
    if (interval === 'week') {
      cur = addDaysUTC(cur, 7);
    } else {
      cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
  return periods;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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
