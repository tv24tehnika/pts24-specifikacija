import { DurableObject } from 'cloudflare:workers';

// One shared room: players enter a name, everyone presses "ready", the round starts for all at once,
// each plays their own copy and reports scores; results are ranked when everyone is done or time runs out.
const GAME_MS = (480 + 30) * 1000;  // 8 min game clock + grace
const COUNTDOWN_MS = 5000;
const AUTO_MS = 60e3;  // with 2+ ready, wait this long for the rest, then start without them
const MAX_PLAYERS = 16;
const CHAT_KEEP = 40;
const STALE_MS = 75e3;  // clients ping every 25 s; silence this long means the connection is dead
const ORIGINS = [/^https:\/\/(www\.)?pts24\.lv$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return new Response('ATP250 derigs', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (!ORIGINS.some(r => r.test(req.headers.get('Origin') || ''))) return new Response('Forbidden', { status: 403 });
    return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req);
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
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || { phase: 'lobby', startAt: 0, endAt: 0, autoAt: 0, round: 0, left: [], last: null };
      this.chat = (await ctx.storage.get('chat')) || [];
    });
  }

  async fetch() {
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
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch {} }
  broadcast(m, except) { const s = JSON.stringify(m); for (const { ws } of this.named(except)) { try { ws.send(s); } catch {} } }
  state(except) {
    const pub = a => ({ id: a.id, name: a.name, ready: a.ready, inGame: a.inGame, score: a.score, cables: a.cables, done: a.done });
    const players = this.named(except).map(p => pub(p.a));
    if (this.room.phase === 'playing') players.push(...this.room.left.map(p => ({ ...p, inGame: true, left: true })));
    const r = this.room;
    this.broadcast({ t: 'state', phase: r.phase, startAt: r.startAt, endAt: r.endAt, autoAt: r.autoAt || 0, now: Date.now(), players, last: r.last }, except);
  }
  async sys(text, except) {
    const msg = { sys: true, text, ts: Date.now() };
    this.chat = [...this.chat, msg].slice(-CHAT_KEEP);
    await this.ctx.storage.put('chat', this.chat);
    this.broadcast({ t: 'chat', msg }, except);
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
    await this.sweep();
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    const r = this.room;

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
    if (m.t === 'chat') {
      const text = clean(m.text, 200);
      const now = Date.now();
      if (!text || now - me.lastChat < 600) return;
      me.lastChat = now;
      ws.serializeAttachment(me);
      const msg = { from: me.name, id: me.id, text, ts: now };
      this.chat = [...this.chat, msg].slice(-CHAT_KEEP);
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

  async webSocketClose(ws) { await this.gone(ws); try { ws.close(1000, 'bye'); } catch {} }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws, why = 'izgāja') {
    const me = ws.deserializeAttachment();
    if (!me || !me.name || me.gone) return;
    me.gone = true;
    ws.serializeAttachment(me);
    if (this.room.phase === 'playing' && me.inGame) {
      this.room.left.push({ id: me.id, name: me.name, score: me.score, cables: me.cables, done: me.done });
      await this.save();
    }
    await this.sys(`${me.name} ${why}`, ws);
    await this.checkStart(ws);
    if (!(await this.checkEnd(ws))) this.state(ws);
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
    r.last = { round: r.round, results };
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
      await this.ctx.storage.setAlarm(r.endAt);
      await this.save();
      return this.state();
    }
    if (r.phase === 'playing') await this.endRound();
  }
}
