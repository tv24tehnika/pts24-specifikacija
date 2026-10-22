import { DurableObject } from 'cloudflare:workers';

// One shared room: players enter a name, everyone presses "ready", the round starts for all at once,
// each plays their own copy and reports scores; results are ranked when everyone is done or time runs out.
const GAME_MS = 900e3;  // 8 min game clock + earned extra time (drums, producer, bribes, last call) + grace
const TEAM_BASE_S = 480 + 30;  // team mode: shared clock (8 min + grace) plus whatever the team earns
const CABLES = 8;
const COUNTDOWN_MS = 5000;
const AUTO_MS = 60e3;  // with 2+ ready, wait this long for the rest, then start without them
const MAX_PLAYERS = 16;
const CHAT_KEEP = 40;
const KEEP_MS = 3600e3;  // chat and the last round's results are forgotten after an hour
const STALE_MS = 75e3;  // clients ping every 25 s; silence this long means the connection is dead
const HISTORY_KEEP = 5000;  // rows of played results kept for the admin page and the leaderboard
const ORIGINS = [/^https:\/\/(www\.)?pts24\.lv$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const cors = origin => ({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' });
// compare via hashes so the check takes the same time whatever the key
async function sameKey(a, b) {
  const h = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return crypto.subtle.timingSafeEqual(await h(a), await h(b));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '', allowed = ORIGINS.some(r => r.test(origin));
    const room = env.ROOM.get(env.ROOM.idFromName('main'));
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (!allowed) return new Response('Forbidden', { status: 403 });
      return room.fetch(req);
    }
    // /top: public leaderboard · /solo: a single-player result from the page · /admin: full history behind ADMIN_KEY
    if (!['/top', '/solo', '/admin'].includes(url.pathname)) return new Response('ATP250 derigs', { status: 404 });
    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? cors(origin) : {} });
    if (url.pathname === '/solo' && (req.method !== 'POST' || !allowed)) return new Response('Forbidden', { status: 403 });
    if (url.pathname === '/admin') {
      const key = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!env.ADMIN_KEY || !key || !(await sameKey(key, env.ADMIN_KEY)))
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: allowed ? cors(origin) : {} });
    }
    const res = await room.fetch(req);
    if (!allowed) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors(origin))) out.headers.set(k, v);
    return out;
  },
};

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const int = v => Math.max(0, Math.min(1e6, Math.round(+v || 0)));

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keepalive from clients (idle connections get dropped by proxies) answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.seen = new Map();
    this.soloAt = new Map();
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS plays (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, round INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, cables INTEGER NOT NULL, left_early INTEGER NOT NULL DEFAULT 0,
      team_cables INTEGER, team_win INTEGER)`);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || { phase: 'lobby', mode: 'race', startAt: 0, endAt: 0, autoAt: 0, round: 0, left: [], last: null };
      this.chat = (await ctx.storage.get('chat')) || [];
    });
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/top') return Response.json({ top: this.top() });
    if (path === '/admin') return Response.json(this.admin());
    if (path === '/solo') {
      const b = await req.json().catch(() => null), name = clean(b && b.name, 20), now = Date.now();
      if (!name) return Response.json({ ok: false }, { status: 400 });
      // one result per name every 30 s is plenty for a real game
      if (now - (this.soloAt.get(name.toLowerCase()) || 0) < 30e3) return Response.json({ ok: false }, { status: 429 });
      this.soloAt.set(name.toLowerCase(), now);
      this.record([{ name, score: Math.min(int(b.score), 100000), cables: Math.min(int(b.cables), CABLES), left: false }], 'solo', 0, null);
      return Response.json({ ok: true, top: this.top() });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: '', ready: false, inGame: false, score: 0, cables: 0, done: false, lastChat: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  // open sockets of players who have entered a name
  named(except) {
    return this.ctx.getWebSockets().filter(ws => ws !== except && ws.readyState === 1)
      .map(ws => ({ ws, a: ws.deserializeAttachment() })).filter(p => p.a.name);
  }
  save() { return this.ctx.storage.put('room', this.room); }

  record(rows, mode, round, team) {
    const at = Date.now();
    for (const p of rows) this.sql.exec('INSERT INTO plays (at, round, mode, name, score, cables, left_early, team_cables, team_win) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      at, round, mode, p.name, p.score, p.cables, p.left ? 1 : 0, team ? team.cables : null, team ? (team.win ? 1 : 0) : null);
    this.sql.exec('DELETE FROM plays WHERE id <= (SELECT MAX(id) FROM plays) - ?', HISTORY_KEEP);
  }
  // each player's best result
  top(n = 10) {
    return this.sql.exec(`SELECT name, score, cables, mode, at FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY score DESC, at) AS rn
      FROM plays WHERE score > 0) WHERE rn = 1 ORDER BY score DESC LIMIT ?`, n).toArray();
  }
  admin() {
    const players = this.sql.exec(`SELECT name, COUNT(*) AS games, MAX(score) AS best, CAST(AVG(score) AS INTEGER) AS avg, SUM(cables) AS cables,
      MIN(at) AS first, MAX(at) AS last FROM plays GROUP BY lower(name) ORDER BY last DESC`).toArray();
    const plays = this.sql.exec('SELECT * FROM plays ORDER BY id DESC LIMIT 1000').toArray();
    return { players, plays, top: this.top(20), now: Date.now() };
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch {} }
  broadcast(m, except) { const s = JSON.stringify(m); for (const { ws } of this.named(except)) { try { ws.send(s); } catch {} } }
  state(except) {
    const pub = a => ({ id: a.id, name: a.name, ready: a.ready, inGame: a.inGame, score: a.score, cables: a.cables, done: a.done });
    const players = this.named(except).map(p => pub(p.a));
    if (this.room.phase === 'playing') players.push(...this.room.left.map(p => ({ ...p, inGame: true, left: true })));
    const r = this.room;
    const team = r.phase === 'playing' && r.mode === 'team' ? { cables: r.cables, bonus: r.bonus, bribes: r.bribes, lastCall: r.lastCall } : null;
    this.broadcast({ t: 'state', phase: r.phase, mode: r.mode || 'race', startAt: r.startAt, endAt: r.endAt, autoAt: r.autoAt || 0, now: Date.now(), players, last: r.last, team }, except);
  }
  async sys(text, except) {
    const msg = { sys: true, text, ts: Date.now() };
    this.chat = [...this.chat.filter(m => m.ts > msg.ts - KEEP_MS), msg].slice(-CHAT_KEEP);
    await this.ctx.storage.put('chat', this.chat);
    this.broadcast({ t: 'chat', msg }, except);
  }

  // drop chat and results older than KEEP_MS; with nobody around, wake up later so nothing lingers in storage
  async purge(except) {
    const r = this.room, cut = Date.now() - KEEP_MS;
    const chat = this.chat.filter(m => m.ts > cut);
    if (chat.length !== this.chat.length) { this.chat = chat; await this.ctx.storage.put('chat', chat); }
    if (r.last && !(r.last.at > cut)) { r.last = null; await this.save(); }
    if (r.phase !== 'lobby' || r.autoAt || this.named(except).length) return;
    const next = Math.min(...this.chat.map(m => m.ts), r.last ? r.last.at : Infinity);
    if (next < Infinity) await this.ctx.storage.setAlarm(next + KEEP_MS + 1000);
  }

  // a socket whose client vanished without a close frame would otherwise sit in the room forever and block the start
  stale(ws) {
    // only clients that send keepalive pings can be judged; older pages never ping
    const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime();
    return !!ping && Date.now() - Math.max(ping, this.seen.get(ws) || 0) > STALE_MS;
  }
  async sweep() {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1 || !this.stale(ws)) continue;
      try { ws.close(4001, 'timeout'); } catch {}
      await this.gone(ws);
    }
  }

  async webSocketMessage(ws, raw) {
    this.seen.set(ws, Date.now());
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    const r = this.room;

    // positions (4/s per player) are relayed as-is, never stored
    if (m.t === 'pos') {
      if (!me.inGame || r.phase !== 'playing') return;
      const n = v => Math.round((+v || 0) * 100) / 100;
      return this.broadcast({ t: 'pos', id: me.id, x: n(m.x), y: n(m.y), h: n(m.h), k: clean(m.k, 8), c: !!m.c }, ws);
    }
    await this.sweep();

    if (m.t === 'hello') {
      const name0 = clean(m.name, 20);
      if (!name0) return this.send(ws, { t: 'error', text: 'Ieraksti vārdu.' });
      const others = this.named(ws);
      if (!me.name && others.length >= MAX_PLAYERS) { this.send(ws, { t: 'error', text: 'Istaba ir pilna.' }); return ws.close(4000, 'full'); }
      // keep the client's id across reconnects; rejoin a running round if this player dropped out of it
      if (/^[0-9a-f]{8}$/.test(m.id || '')) {
        // same client reconnecting: drop its old socket first
        for (const p of others.filter(p => p.a.id === m.id)) { try { p.ws.close(4002, 'replaced'); } catch {} await this.gone(p.ws); }
        me.id = m.id;
        const i = m.resume && r.phase === 'playing' ? r.left.findIndex(p => p.id === m.id) : -1;
        if (i >= 0) { const p = r.left.splice(i, 1)[0]; Object.assign(me, { inGame: true, score: p.score, cables: p.cables, done: p.done }); await this.save(); }
      }
      const taken = new Set(this.named(ws).map(p => p.a.name.toLowerCase()));
      let name = name0;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${name0.slice(0, 17)} ${n}`;
      const isNew = !me.name;
      me.name = name;
      ws.serializeAttachment(me);
      await this.purge();
      this.send(ws, { t: 'welcome', id: me.id, name });
      this.send(ws, { t: 'history', msgs: this.chat });
      if (isNew) await this.sys(`${name} ienāca istabā`, ws);
      await this.checkStart();
      return this.state();
    }
    if (!me.name) return;

    if (m.t === 'ready') {
      if (r.phase === 'playing') return;
      me.ready = !!m.v;
      ws.serializeAttachment(me);
      await this.checkStart();
      return this.state();
    }
    if (m.t === 'mode') {
      if (r.phase !== 'lobby' || !['race', 'team'].includes(m.v) || r.mode === m.v) return;
      r.mode = m.v;
      // everyone confirms again for the new mode
      for (const p of this.named()) p.ws.serializeAttachment({ ...p.a, ready: false });
      await this.sys(`${me.name} izvēlējās režīmu: ${m.v === 'team' ? 'Komanda' : 'Sacensība'}`);
      await this.checkStart();
      return this.state();
    }
    // team mode: one shared hall. A cable belongs to whoever unplugged (or picked) it; only the owner reports progress, about once a second
    if (r.mode === 'team' && r.phase === 'playing' && me.inGame && ['claim', 'cab', 'bonus'].includes(m.t)) return this.team(ws, me, m);
    if (m.t === 'chat') {
      const text = clean(m.text, 200);
      const now = Date.now();
      if (!text || now - me.lastChat < 600) return;
      me.lastChat = now;
      ws.serializeAttachment(me);
      const msg = { from: me.name, id: me.id, text, ts: now };
      this.chat = [...this.chat.filter(m => m.ts > now - KEEP_MS), msg].slice(-CHAT_KEEP);
      await this.ctx.storage.put('chat', this.chat);
      return this.broadcast({ t: 'chat', msg });
    }
    if ((m.t === 'score' || m.t === 'done') && me.inGame && !me.done && r.phase === 'playing') {
      me.score = int(m.score);
      me.cables = int(m.cables);
      if (m.t === 'done') me.done = true;
      ws.serializeAttachment(me);
      if (me.done && await this.checkEnd()) return;
      return this.state();
    }
  }

  async team(ws, me, m) {
    const r = this.room;
    if (m.t === 'claim') {
      const i = int(m.i), c = r.cables[i];
      if (!c) return;
      if (c.st !== 'live' && c.st !== 'left') return this.send(ws, { t: 'cab', i, ...c, deny: true });
      Object.assign(c, { st: 'held', o: me.id, n: me.name });
      await this.save();
      return this.broadcast({ t: 'cab', i, ...c });
    }
    if (m.t === 'cab') {
      const i = int(m.i), c = r.cables[i];
      if (!c || c.o !== me.id) return;
      c.s = Math.max(c.s, Math.min(1000, +m.s || 0));
      if (m.st === 'left' || m.st === 'done') { Object.assign(c, { st: m.st, o: null }); if (m.st === 'done') c.n = me.name; await this.save(); }
      return this.broadcast({ t: 'cab', i, ...c }, ws);
    }
    if (m.t === 'bonus') {
      if (m.kind === 'bribe') { if (r.bribes >= 2) return; r.bribes++; }
      if (m.kind === 'last') { if (r.lastCall) return; r.lastCall = true; }
      r.bonus = Math.max(-300, Math.min(1200, r.bonus + Math.max(-30, Math.min(60, +m.s || 0))));
      r.endAt = r.startAt + (TEAM_BASE_S + Math.max(0, r.bonus)) * 1000;
      await this.ctx.storage.setAlarm(r.endAt);
      await this.save();
      return this.broadcast({ t: 'bonus', total: r.bonus, bribes: r.bribes, lastCall: r.lastCall });
    }
  }

  async webSocketClose(ws) { await this.gone(ws); try { ws.close(1000, 'bye'); } catch {} }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws, why = 'izgāja') {
    const me = ws.deserializeAttachment();
    if (!me || !me.name || me.gone) return;
    me.gone = true;
    ws.serializeAttachment(me);
    if (this.room.phase === 'playing' && me.inGame) {
      this.room.left.push({ id: me.id, name: me.name, score: me.score, cables: me.cables, done: me.done });
      if (this.room.mode === 'team') this.room.cables.forEach((c, i) => {
        if (c.o === me.id) { Object.assign(c, { st: 'left', o: null }); this.broadcast({ t: 'cab', i, ...c }, ws); }
      });
      await this.save();
    }
    await this.sys(`${me.name} ${why}`, ws);
    await this.checkStart(ws);
    if (!(await this.checkEnd(ws))) this.state(ws);
    await this.purge(ws);
  }

  // all ready → short countdown; 2+ ready but someone isn't → start without them after AUTO_MS
  async checkStart(except) {
    const r = this.room;
    if (r.phase === 'playing') return;
    const ps = this.named(except), ready = ps.filter(p => p.a.ready).length, all = ps.length > 0 && ready === ps.length;
    if (r.phase === 'countdown' && ready > 0) return;  // newcomers can't stop a countdown; they join by pressing ready or wait
    if (all) {
      if (r.phase !== 'countdown') Object.assign(r, { phase: 'countdown', startAt: Date.now() + COUNTDOWN_MS });
      r.autoAt = 0;
    } else {
      r.phase = 'lobby';
      r.autoAt = ready >= 2 ? r.autoAt || Date.now() + AUTO_MS : 0;
    }
    const at = r.phase === 'countdown' ? r.startAt : r.autoAt;
    if (at) await this.ctx.storage.setAlarm(at); else await this.ctx.storage.deleteAlarm();
    await this.save();
  }

  // true when the round ended (results already broadcast)
  async checkEnd(except) {
    if (this.room.phase !== 'playing') return false;
    if (!this.named(except).filter(p => p.a.inGame).every(p => p.a.done)) return false;
    await this.endRound(except);
    return true;
  }

  async endRound(except) {
    const r = this.room, ps = this.named(except);
    const results = [...ps.filter(p => p.a.inGame).map(({ a }) => ({ id: a.id, name: a.name, score: a.score, cables: a.cables, done: a.done })),
      ...r.left.map(p => ({ ...p, left: true }))].sort((a, b) => b.score - a.score);
    r.round++;
    r.last = { round: r.round, results, at: Date.now() };
    const mode = r.mode || 'race';
    if (r.mode === 'team' && r.cables) {
      const done = r.cables.filter(c => c.st === 'done').length;
      // in a shared hall each player's count is the cables they finished themselves
      for (const p of results) p.cables = r.cables.filter(c => c.st === 'done' && c.n === p.name).length;
      r.last.team = { win: done === CABLES, cables: done, total: results.reduce((a, p) => a + p.score, 0) };
    }
    this.record(results, mode, r.round, r.last.team || null);
    Object.assign(r, { phase: 'lobby', left: [] });
    for (const { ws, a } of ps) ws.serializeAttachment({ ...a, inGame: false, done: false, ready: false });
    await this.ctx.storage.deleteAlarm();
    await this.save();
    this.state(except);
  }

  async alarm() {
    const r = this.room;
    if (r.phase === 'lobby' && r.autoAt) {
      r.autoAt = 0;
      for (const { ws, a } of this.named()) {
        if (a.ready) continue;
        this.send(ws, { t: 'kicked', text: 'Tu nenospiedi „Esmu gatavs”, tāpēc raunds sākās bez tevis. Vari ienākt atpakaļ un spēlēt nākamajā raundā.' });
        try { ws.close(4003, 'not ready'); } catch {}
        await this.gone(ws, 'izmests: nebija gatavs');
      }
      await this.checkStart();
      return this.state();
    }
    if (r.phase === 'countdown') {
      const ps = this.named();
      if (!ps.some(p => p.a.ready)) { r.phase = 'lobby'; await this.save(); return this.state(); }
      for (const { ws, a } of ps) ws.serializeAttachment({ ...a, inGame: a.ready, ready: false, score: 0, cables: 0, done: false });
      Object.assign(r, { phase: 'playing', endAt: r.startAt + GAME_MS, left: [] });
      if (r.mode === 'team') Object.assign(r, { endAt: r.startAt + TEAM_BASE_S * 1000, bonus: 0, bribes: 0, lastCall: false,
        cables: Array.from({ length: CABLES }, () => ({ st: 'live', s: 0, o: null, n: '' })) });
      await this.ctx.storage.setAlarm(r.endAt);
      await this.save();
      return this.state();
    }
    if (r.phase === 'playing') return this.endRound();
    await this.purge();
  }
}
