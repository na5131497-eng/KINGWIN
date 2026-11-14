const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

let DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://neondb_owner:npg_ClW25VuNgUSc@ep-delicate-sea-beqrez4i.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';
if (DATABASE_URL.includes('sslmode=require')) DATABASE_URL = DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full');
if (!DATABASE_URL.includes('sslmode=')) DATABASE_URL += (DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=verify-full';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 10
});
pool.on('error', (err) => console.error('PG Pool error:', err.message));

function todayStr(){ return new Date().toISOString().slice(0, 10); }

// ============================================================
// ===================== RTP ENGINE ===========================
// ============================================================
const BASE_RTP   = 0.80;
const MIN_RTP    = 0.50;
const FEEDBACK_K = 0.5;
const MAX_WIN    = 5000;
const DRAIN_RTP_MAX = 0.95;

async function getHouseBalance() {
  try {
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='доход' THEN sum ELSE 0 END),0)::numeric AS income,
        COALESCE(SUM(CASE WHEN type='расход' THEN sum ELSE 0 END),0)::numeric AS expense
      FROM online`);
    const income = parseFloat(r.rows[0].income) || 0;
    const expense = parseFloat(r.rows[0].expense) || 0;
    return { income, expense, balance: income - expense };
  } catch(e) { return { income: 0, expense: 0, balance: 0 }; }
}

async function applyDrain(rtp) {
  const house = await getHouseBalance();
  if (house.balance >= 0) return rtp;
  const deficit = Math.abs(house.balance);
  const boost = Math.min(0.15, deficit / 1000 * 0.15);
  return Math.min(DRAIN_RTP_MAX, Math.max(rtp, rtp + boost));
}

async function getPlayerRTP(guestId) {
  const r = await pool.query(
    'SELECT rtp, session_profit, session_turnover FROM guests WHERE id=$1',
    [guestId]
  );
  if (!r.rows.length) return BASE_RTP;
  const g = r.rows[0];
  const profit   = parseFloat(g.session_profit)   || 0;
  const turnover = parseFloat(g.session_turnover) || 0;

  let rtp = BASE_RTP;
  if (turnover >= 100) {
    const realRTP = 0.5 + (profit / turnover) * 0.5;
    rtp = BASE_RTP - (realRTP - BASE_RTP) * FEEDBACK_K;
    rtp = Math.min(BASE_RTP, Math.max(MIN_RTP, rtp));
  }
  rtp = await applyDrain(rtp);
  try {
    await pool.query('UPDATE guests SET rtp=$1, last_rtp_update=NOW() WHERE id=$2', [rtp, guestId]);
  } catch(e){}
  return rtp;
}

async function recordSession(guestId, bet, win) {
  try {
    await pool.query(
      `UPDATE guests
       SET session_turnover = COALESCE(session_turnover,0) + $1,
           session_profit   = COALESCE(session_profit,0)   + $2
       WHERE id=$3`,
      [bet, win - bet, guestId]
    );
  } catch(e){}
}

// ============================================================
// ========== ГЛОБАЛЬНЫЙ РАУНД КРАША ==========================
// ============================================================
const CRASH_WAIT_MS    = 5000;
const CRASH_FLY_MAX_MS = 60000;
const CRASH_PAUSE_MS   = 2500;
const CRASH_GROWTH     = 1.06;

const crashState = {
  roundId: 0,
  status: 'waiting',
  crashPoint: 0,
  startTime: 0,
  waitStart: Date.now(),
  history: [],
  bets: new Map(),                // bet_id -> { guestId, amount, cashedOut, cashoutMult }
  activeBetsByGuest: new Map()    // guestId -> bet_id
};

function nextRound() {
  crashState.roundId++;
  crashState.status = 'waiting';
  crashState.crashPoint = 0;
  crashState.startTime = 0;
  crashState.waitStart = Date.now();
  // ВАЖНО: bets НЕ чистим здесь — они чистятся в crashNow после расчёта.
  // Если оставить в waiting — ставки, поставленные до этого, уже отработаны.
  // Но чтобы при перезагрузке можно было узнать — чистим в начале полёта.
  console.log(`[CRASH] Round #${crashState.roundId} — waiting`);
  setTimeout(() => startFlying(), CRASH_WAIT_MS);
}

async function startFlying() {
  // Ставки на этот раунд уже были зарегистрированы в waiting.
  // Чистим карты — начинаем новый «платёжный цикл» для этого полёта.
  crashState.bets.clear();
  crashState.activeBetsByGuest.clear();

  const house = await getHouseBalance();
  let rtp = BASE_RTP;
  if (house.balance < 0) {
    const deficit = Math.abs(house.balance);
    const boost = Math.min(0.15, deficit / 1000 * 0.15);
    rtp = Math.min(DRAIN_RTP_MAX, BASE_RTP + boost);
  }

  const u = Math.random();
  let crash;
  if (u < (1 - rtp)) crash = 1.00;
  else {
    const u2 = (u - (1 - rtp)) / rtp;
    crash = rtp / (1 - u2);
  }
  crash = Math.max(1.00, Math.min(crash, 100));

  crashState.crashPoint = Math.round(crash * 100) / 100;
  crashState.status = 'flying';
  crashState.startTime = Date.now();
  console.log(`[CRASH] Round #${crashState.roundId} — flying, crashPoint=${crashState.crashPoint}`);

  setTimeout(() => { if (crashState.status === 'flying') crashNow(); }, CRASH_FLY_MAX_MS);
}

async function crashNow() {
  if (crashState.status !== 'flying') return;
  crashState.status = 'crashed';

  const v = crashState.crashPoint;
  crashState.history.unshift(v);
  if (crashState.history.length > 10) crashState.history.pop();
  console.log(`[CRASH] Round #${crashState.roundId} — CRASHED at ${v}x`);

  // Все ставки из БД этого раунда, которые не cashed_out — фиксируем как проигрыш
  try {
    const active = await pool.query(
      `SELECT * FROM crash_bets WHERE cashed_out=FALSE AND crash_point=$1`,
      [v]
    );
    for (const bet of active.rows) {
      await pool.query('UPDATE crash_bets SET cashed_out=TRUE WHERE id=$1', [bet.id]);
      await recordSession(bet.guest_id, parseFloat(bet.amount), 0);
      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`,
        [todayStr(), parseFloat(bet.amount), `Crash crash r#${crashState.roundId} (${bet.guest_id})`]
      );
    }
  } catch(e){ console.error('crashNow bets cleanup:', e.message); }

  setTimeout(() => nextRound(), CRASH_PAUSE_MS);
}

// Публичное состояние для клиента. НЕ отдаёт crashPoint пока летит.
function getPublicCrashState() {
  const now = Date.now();
  if (crashState.status === 'flying') {
    const elapsed = (now - crashState.startTime) / 1000;
    const currentMult = Math.pow(CRASH_GROWTH, elapsed);
    if (currentMult >= crashState.crashPoint) {
      crashNow();
      return {
        roundId: crashState.roundId,
        status: 'crashed',
        crashPoint: crashState.crashPoint,
        elapsed: 0,
        currentMult: crashState.crashPoint
      };
    }
    return {
      roundId: crashState.roundId,
      status: 'flying',
      crashPoint: 0,
      elapsed,
      currentMult: Math.round(currentMult * 100) / 100
    };
  }
  if (crashState.status === 'crashed') {
    return {
      roundId: crashState.roundId,
      status: 'crashed',
      crashPoint: crashState.crashPoint,
      elapsed: 0,
      currentMult: crashState.crashPoint
    };
  }
  return {
    roundId: crashState.roundId,
    status: 'waiting',
    crashPoint: 0,
    elapsed: 0,
    currentMult: 1.00,
    waitLeftMs: Math.max(0, CRASH_WAIT_MS - (now - crashState.waitStart))
  };
}

// ============================================================
// ============== CRASH ANTI-BAD-STREAK (per player) ==========
// ============================================================
const crashHistoryMap = new Map();
function pushCrash(guestId, value) {
  const arr = crashHistoryMap.get(guestId) || [];
  arr.push({ value, ts: Date.now() });
  while (arr.length > 10) arr.shift();
  crashHistoryMap.set(guestId, arr);
}

// ============================================================
// ==================== GAME MATH =============================
// ============================================================
const CASES = {
  'Новичок':    { price: 39.99,  prizes: [{v:10,w:42000},{v:15,w:24000},{v:25,w:13000},{v:50,w:8500},{v:100,w:5500},{v:115,w:3200},{v:200,w:1800},{v:250,w:900},{v:500,w:500},{v:650,w:300},{v:1000,w:50}]},
  'Сильвер':    { price: 199,    prizes: [{v:10,w:1500},{v:20,w:2000},{v:50,w:2500},{v:80,w:2000},{v:120,w:1000},{v:200,w:600},{v:300,w:200},{v:500,w:100},{v:1000,w:50},{v:1500,w:30},{v:2000,w:15}]},
  'Голд':       { price: 399,    prizes: [{v:20,w:1500},{v:50,w:2000},{v:100,w:2500},{v:150,w:2000},{v:250,w:1000},{v:400,w:600},{v:600,w:200},{v:1000,w:100},{v:2000,w:50},{v:3000,w:15}]},
  'Платина':    { price: 899,    prizes: [{v:50,w:1500},{v:100,w:2000},{v:200,w:2500},{v:350,w:2000},{v:500,w:1000},{v:900,w:600},{v:1500,w:200},{v:2500,w:100},{v:4000,w:50}]},
  'Королевский':{ price: 4999,   prizes: [{v:200,w:1500},{v:500,w:2000},{v:1000,w:2500},{v:2000,w:2000},{v:3500,w:1000},{v:5000,w:600},{v:10000,w:200}]}
};

const PLINKO_MULTIPLIERS = {
  low:    [1.9,1.4,1.1,0.9,0.5,0.9,1.1,1.4,1.9],
  medium: [5.0,2.0,1.0,0.5,0.2,0.5,1.0,2.0,5.0],
  high:   [10.0,3.0,0.8,0.2,0.1,0.2,0.8,3.0,10.0]
};

function pickPrize(prizes) {
  const total = prizes.reduce((a,p) => a + p.w, 0);
  let r = Math.random() * total;
  for (const p of prizes) { if (r < p.w) return p.v; r -= p.w; }
  return prizes[prizes.length - 1].v;
}
function binom(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}
function computePlinkoRTP(mults) {
  const n = mults.length - 1;
  let total = 0;
  for (let k = 0; k <= n; k++) total += (binom(n, k) / Math.pow(2, n)) * mults[k];
  return total;
}

function spinWithRTP(rtp, bet, gameType, options = {}) {
  if (gameType === 'plinko') {
    const risk = options.risk || 'medium';
    const base = PLINKO_MULTIPLIERS[risk] || PLINKO_MULTIPLIERS.medium;
    const scale = Math.min(2, rtp / computePlinkoRTP(base));
    const scaled = base.map(m => m * scale);
    const pathArr = Array.from({length: 8}, () => Math.random() < 0.5 ? 0 : 1);
    const slot = pathArr.reduce((a,b) => a + b, 0);
    const mult = scaled[slot];
    let win = Math.round(bet * mult * 100) / 100;
    if (win > MAX_WIN) win = MAX_WIN;
    return { path: pathArr, slot, mult: Math.round(mult*100)/100, win };
  }
  if (gameType === 'case') {
    const c = CASES[options.caseName];
    if (!c) return null;
    const tw = c.prizes.reduce((a,p) => a + p.w, 0);
    const ev = c.prizes.reduce((a,p) => a + p.v * p.w, 0) / tw;
    const baseRTP = ev / c.price;
    const scale = Math.min(2, rtp / baseRTP);
    const scaledPrizes = c.prizes.map(p => ({ v: p.v * scale, w: p.w }));
    let prize = pickPrize(scaledPrizes);
    prize = Math.round(prize * 100) / 100;
    if (prize > MAX_WIN) prize = MAX_WIN;
    return { prize };
  }
  return null;
}

// ============================================================
// ========================= БОТЫ =============================
// ============================================================
let crashBots = [];
function initCrashBots() {
  const botNames = ['1789****','4521****','9034****','1122****','8877****','6633****'];
  crashBots = botNames.map(name => ({
    name, bet: [10,25,50,100,200][Math.floor(Math.random()*5)]
  }));
}
function generateBotWin() {
  const bot = crashBots[Math.floor(Math.random()*crashBots.length)];
  const multiplier = [1.5,2.0,3.2,1.8,4.5][Math.floor(Math.random()*5)];
  return {
    game: 'crash', player: bot.name, bet: bot.bet,
    win: Math.round(bot.bet * multiplier * 100) / 100,
    mult: multiplier, created_at: new Date().toISOString()
  };
}

// ============================================================
// ================== БАЛАНС И ВЕЙДЖЕР ========================
// ============================================================
async function debitBet(guestId, amount) {
  const r = await pool.query('SELECT bonus_balance, deposit_balance FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return null;
  let bonus = parseFloat(r.rows[0].bonus_balance) || 0;
  let dep   = parseFloat(r.rows[0].deposit_balance) || 0;
  if (bonus + dep < amount) return null;
  let rem = amount, fromBonus = 0, fromDeposit = 0;
  if (bonus >= rem) { fromBonus = rem; bonus -= rem; rem = 0; }
  else { fromBonus = bonus; rem -= bonus; bonus = 0; fromDeposit = rem; dep -= rem; }
  await pool.query('UPDATE guests SET bonus_balance=$1, deposit_balance=$2 WHERE id=$3', [bonus, dep, guestId]);
  return { fromBonus, fromDeposit };
}

async function creditWin(guestId, winAmount, betAmount) {
  if (winAmount <= 0) return;
  if (winAmount > MAX_WIN) winAmount = MAX_WIN;
  try {
    const g = await pool.query('SELECT wagering_required, wagering_done, bonus_balance FROM guests WHERE id=$1', [guestId]);
    if (!g.rows.length) return;
    const req_ = parseFloat(g.rows[0].wagering_required) || 0;
    const done = parseFloat(g.rows[0].wagering_done) || 0;
    const bonusBal = parseFloat(g.rows[0].bonus_balance) || 0;
    if (req_ > 0 && done < req_) {
      const newDone = done + (betAmount || 0);
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1, wagering_done = $2 WHERE id=$3', [winAmount, newDone, guestId]);
      if (newDone >= req_) {
        const cashback = bonusBal * 2;
        await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1, bonus_balance = 0, wagering_required = 0, wagering_done = 0 WHERE id=$2`, [cashback, guestId]);
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`, [todayStr(), cashback, `Bonus Wager Complete x2 (${guestId})`]);
      }
    } else {
      await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2', [winAmount, guestId]);
    }
  } catch (e) { console.error('creditWin error:', e.message); }
}

async function getBalance(guestId) {
  const r = await pool.query('SELECT deposit_balance, bonus_balance, wagering_required, wagering_done FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return { total: 0, deposit: 0, bonus: 0, wagering: { required: 0, done: 0, left: 0 } };
  const g = r.rows[0];
  const dep = parseFloat(g.deposit_balance) || 0;
  const bon = parseFloat(g.bonus_balance) || 0;
  const req_ = parseFloat(g.wagering_required) || 0;
  const done = parseFloat(g.wagering_done) || 0;
  return { total: dep + bon, deposit: dep, bonus: bon, wagering: { required: req_, done, left: Math.max(0, req_ - done) } };
}

// ============================================================
// ================= ИНИЦИАЛИЗАЦИЯ БАЗЫ =======================
// ============================================================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY, name TEXT, rank TEXT DEFAULT 'Bronze', points INTEGER DEFAULT 0,
        visits INTEGER DEFAULT 0, bonus_text TEXT, bonus_code TEXT, pass TEXT DEFAULT '1234',
        bonus_balance NUMERIC DEFAULT 0, deposit_balance NUMERIC DEFAULT 0,
        wagering_required NUMERIC DEFAULT 0, wagering_done NUMERIC DEFAULT 0,
        last_rank TEXT DEFAULT 'Bronze', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT, sum NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT, sum NUMERIC DEFAULT 0,
        fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS online (
        id SERIAL PRIMARY KEY, date TEXT, type TEXT, sum NUMERIC DEFAULT 0,
        note TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY, game TEXT, player_name TEXT, bet NUMERIC DEFAULT 0,
        result NUMERIC DEFAULT 0, multiplier NUMERIC DEFAULT 0, status TEXT,
        guest_id TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS promo_codes (
        id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'deposit_bonus',
        value NUMERIC DEFAULT 0, min_deposit NUMERIC DEFAULT 0, max_uses INT DEFAULT 1,
        used_count INT DEFAULT 0, active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS active_bonuses (
        id SERIAL PRIMARY KEY, guest_id TEXT NOT NULL, promo_id INT,
        title TEXT DEFAULT 'Бонус', amount NUMERIC DEFAULT 0,
        min_deposit NUMERIC DEFAULT 0, wager_multiplier NUMERIC DEFAULT 5,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealers (
        id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS roulette_sessions (
        id SERIAL PRIMARY KEY, dealer TEXT, nick TEXT, bet_type TEXT,
        bet NUMERIC DEFAULT 0, win NUMERIC DEFAULT 0, won INTEGER DEFAULT 0,
        date TEXT, result_number INTEGER, result_color TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_bets (
        id SERIAL PRIMARY KEY, guest_id TEXT NOT NULL, amount NUMERIC DEFAULT 0,
        crash_point NUMERIC DEFAULT 0, cashed_out BOOLEAN DEFAULT FALSE,
        cashout_mult NUMERIC DEFAULT 0, round_id INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS miner_games (
        id SERIAL PRIMARY KEY,
        guest_id TEXT NOT NULL,
        bet NUMERIC DEFAULT 0,
        mine_pos INT NOT NULL,
        opened TEXT DEFAULT '',
        steps INT DEFAULT 0,
        alive BOOLEAN DEFAULT TRUE,
        cashed_out BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Добавляем round_id если колонка ещё не была (старая таблица)
    await pool.query(`ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS round_id INT DEFAULT 0;`);

    await pool.query(`
      ALTER TABLE guests ADD COLUMN IF NOT EXISTS rtp NUMERIC DEFAULT 0.80;
      ALTER TABLE guests ADD COLUMN IF NOT EXISTS session_profit NUMERIC DEFAULT 0;
      ALTER TABLE guests ADD COLUMN IF NOT EXISTS session_turnover NUMERIC DEFAULT 0;
      ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_rtp_update TIMESTAMP DEFAULT NOW();
    `);

    const dlCheck = await pool.query(`SELECT * FROM dealers WHERE login = 'dealer'`);
    if (dlCheck.rows.length === 0) {
      await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1, $2, $3)`, ['Дилер', 'dealer', '56UpahoS']);
    }

    console.log('✅ База данных готова!');
    initCrashBots();
    setTimeout(() => nextRound(), 1000);
  } catch (e) {
    console.error('❌ Ошибка initDB:', e.message);
    setTimeout(initDB, 5000);
  }
}
initDB();

// ============================================================
// ======================= СЕРВЕР =============================
// ============================================================
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  const sendJSON = (resObj, code, data) => {
    try {
      if (resObj.headersSent) return;
      resObj.writeHead(Number(code) || 200, { 'Content-Type': 'application/json' });
      resObj.end(JSON.stringify(data));
    } catch(e) { console.error('sendJSON error:', e.message); }
  };

  const parseBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e){ resolve({}); } });
  });

  try {
    if (url === '/health') return sendJSON(res, 200, { ok: true });

    // ============================================================
    // ========================= CRASH ============================
    // ============================================================

    // Публичное состояние раунда (полярно одинаковое для всех)
    if (url === '/api/crash/current' && method === 'GET') {
      return sendJSON(res, 200, getPublicCrashState());
    }

    // Общая история крашей
    if (url === '/api/crash/history' && method === 'GET') {
      return sendJSON(res, 200, { history: crashState.history });
    }

    // КРИТИЧНО: восстановление состояния для игрока после перезагрузки
    // Возвращает: статус раунда + текущую ставку игрока (если есть)
    if (url === '/api/crash/state' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guestId = u.searchParams.get('guest_id');
      const round = getPublicCrashState();

      let myBet = null;
      if (guestId) {
        // Активная ставка игрока в ТЕКУЩЕМ раунде
        try {
          const r = await pool.query(
            `SELECT id, amount, cashed_out, cashout_mult FROM crash_bets
             WHERE guest_id=$1 AND round_id=$2 ORDER BY id DESC LIMIT 1`,
            [guestId, crashState.roundId]
          );
          if (r.rows.length) {
            myBet = {
              bet_id: r.rows[0].id,
              amount: parseFloat(r.rows[0].amount),
              cashed_out: r.rows[0].cashed_out,
              cashout_mult: parseFloat(r.rows[0].cashout_mult) || 0
            };
          }
        } catch(e){}
      }

      return sendJSON(res, 200, {
        ...round,
        my_bet: myBet,
        history: crashState.history
      });
    }

    // Поставить на ТЕКУЩИЙ раунд (только waiting)
    if (url === '/api/crash/start' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || b.player_id || '');
      const amt = parseFloat(b.amount) || 0;
      if (amt < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите' });

      if (crashState.status !== 'waiting') {
        return sendJSON(res, 400, { error: 'Приём ставок закрыт. Ждите следующий раунд.' });
      }

      // Уже была ставка в этом раунде?
      const existing = await pool.query(
        `SELECT id, amount FROM crash_bets WHERE guest_id=$1 AND round_id=$2 LIMIT 1`,
        [guestId, crashState.roundId]
      );
      if (existing.rows.length) {
        return sendJSON(res, 400, {
          error: 'У вас уже есть ставка в этом раунде',
          bet_id: existing.rows[0].id,
          amount: parseFloat(existing.rows[0].amount)
        });
      }

      const debited = await debitBet(guestId, amt);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });

      const r = await pool.query(
        `INSERT INTO crash_bets (guest_id, amount, crash_point, round_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [guestId, amt, 0, crashState.roundId]
      );
      const betId = r.rows[0].id;

      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`,
        [todayStr(), amt, `Crash bet r#${crashState.roundId} (${guestId})`]
      );

      const bal = await getBalance(guestId);
      return sendJSON(res, 200, {
        ok: true, bet_id: betId, amount: amt, round_id: crashState.roundId,
        balance: bal.total, deposit_balance: bal.deposit,
        bonus_balance: bal.bonus, wagering: bal.wagering
      });
    }

    // Кэшаут по bet_id (проверка по глобальному crashPoint и round_id)
    if (url === '/api/crash/cashout' && method === 'POST') {
      const b = await parseBody(req);
      const betId = parseInt(b.bet_id) || 0;
      const mult = parseFloat(b.mult) || 0;
      const guestId = String(b.guest_id || b.player_id || '');

      if (crashState.status !== 'flying') {
        return sendJSON(res, 400, { error: 'Раунд не в полёте' });
      }

      const r = await pool.query(
        `SELECT * FROM crash_bets WHERE id=$1 AND guest_id=$2 AND cashed_out=FALSE AND round_id=$3`,
        [betId, guestId, crashState.roundId]
      );
      if (!r.rows.length) return sendJSON(res, 400, { error: 'Ставка не найдена в этом раунде' });

      if (mult > crashState.crashPoint) {
        return sendJSON(res, 400, { error: 'Краш уже случился', crash_point: crashState.crashPoint });
      }

      const bet = r.rows[0];
      let win = Math.round(parseFloat(bet.amount) * mult * 100) / 100;
      if (win > MAX_WIN) win = MAX_WIN;

      await pool.query(
        'UPDATE crash_bets SET cashed_out=TRUE, cashout_mult=$1, crash_point=$2 WHERE id=$3',
        [mult, crashState.crashPoint, betId]
      );
      await creditWin(guestId, win, parseFloat(bet.amount));
      await recordSession(guestId, parseFloat(bet.amount), win);
      pushCrash(guestId, mult);

      const net = parseFloat(bet.amount) - win;
      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`,
        [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Crash cashout r#${crashState.roundId} (${guestId})`]
      );

      const bal = await getBalance(guestId);
      return sendJSON(res, 200, {
        ok: true, win, mult, balance: bal.total,
        deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering
      });
    }

    // Старый endpoint для совместимости
    if (url === '/api/crash/peek' && method === 'GET') {
      return sendJSON(res, 200, { crash_point: crashState.status === 'crashed' ? crashState.crashPoint : 0 });
    }
    if (url === '/api/crash/result' && method === 'GET') {
      return sendJSON(res, 200, { crash_point: crashState.crashPoint });
    }
    if (url === '/api/crash/bet' && method === 'POST') {
      // Резерв: просто списывает (на случай старых клиентов)
      const b = await parseBody(req);
      const amt = parseFloat(b.amount) || 0;
      const guestId = String(b.player_id || b.guest_id || '');
      if (amt < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите' });
      const debited = await debitBet(guestId, amt);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`, [todayStr(), amt, `Crash bet (${guestId})`]);
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    // ============================================================
    // ========================= MINER ============================
    // ============================================================
    if (url === '/api/miner/start' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = parseFloat(b.bet) || 0;
      if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const minePos = Math.floor(Math.random() * 25);
      const r = await pool.query(
        `INSERT INTO miner_games (guest_id, bet, mine_pos, steps) VALUES ($1, $2, $3, 0) RETURNING id`,
        [guestId, bet, minePos]
      );
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`, [todayStr(), bet, `Miner bet (${guestId})`]);
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, game_id: r.rows[0].id, balance: bal.total });
    }

    if (url === '/api/miner/step' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const gameId = parseInt(b.game_id) || 0;
      const cellIndex = parseInt(b.cell_index);
      if (!gameId) return sendJSON(res, 400, { error: 'Нет game_id' });
      if (isNaN(cellIndex) || cellIndex < 0 || cellIndex > 24) return sendJSON(res, 400, { error: 'Неверная ячейка' });

      const r = await pool.query(
        `SELECT * FROM miner_games WHERE id=$1 AND guest_id=$2 AND alive=TRUE AND cashed_out=FALSE`,
        [gameId, guestId]
      );
      if (!r.rows.length) return sendJSON(res, 400, { error: 'Игра не найдена' });

      const game = r.rows[0];
      const opened = (game.opened || '').split(',').filter(x => x !== '');
      if (opened.includes(String(cellIndex))) return sendJSON(res, 400, { error: 'Ячейка уже открыта' });

      if (cellIndex === game.mine_pos) {
        await pool.query('UPDATE miner_games SET alive=FALSE WHERE id=$1', [gameId]);
        await recordSession(guestId, parseFloat(game.bet), 0);
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`, [todayStr(), parseFloat(game.bet), `Miner lose (${guestId})`]);
        return sendJSON(res, 200, { ok: true, survive: false, mine_pos: game.mine_pos, mult: 0 });
      }

      opened.push(String(cellIndex));
      const newStep = game.steps + 1;
      const rtp = await getPlayerRTP(guestId);
      const baseMult = Math.pow(1.2, newStep - 1);

      await pool.query('UPDATE miner_games SET opened=$1, steps=$2 WHERE id=$3', [opened.join(','), newStep, gameId]);
      return sendJSON(res, 200, {
        ok: true, survive: true,
        mult: Math.round(baseMult * 100) / 100,
        next_mult: Math.round(baseMult * 1.2 * 100) / 100,
        steps: newStep, rtp: Math.round(rtp * 100) / 100
      });
    }

    if (url === '/api/miner/cashout' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const gameId = parseInt(b.game_id) || 0;
      if (!gameId) return sendJSON(res, 400, { error: 'Нет game_id' });

      const r = await pool.query(
        `SELECT * FROM miner_games WHERE id=$1 AND guest_id=$2 AND alive=TRUE AND cashed_out=FALSE`,
        [gameId, guestId]
      );
      if (!r.rows.length) return sendJSON(res, 400, { error: 'Игра не найдена' });

      const game = r.rows[0];
      if (game.steps < 1) return sendJSON(res, 400, { error: 'Откройте хотя бы одну ячейку' });

      let mult = Math.pow(1.2, game.steps - 1);
      let win = Math.round(parseFloat(game.bet) * mult * 100) / 100;
      if (win > MAX_WIN) win = MAX_WIN;

      await creditWin(guestId, win, parseFloat(game.bet));
      await recordSession(guestId, parseFloat(game.bet), win);
      await pool.query('UPDATE miner_games SET cashed_out=TRUE WHERE id=$1', [gameId]);
      await pool.query(
        `INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['miner', guestId, parseFloat(game.bet), win, Math.round(mult*100)/100, 'win', guestId]
      );
      const net = parseFloat(game.bet) - win;
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Miner cashout (${guestId})`]);
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, win, balance: bal.total, mult: Math.round(mult*100)/100 });
    }

    // ============================================================
    // ======================== PLINKO ============================
    // ============================================================
    if (url === '/api/plinko/drop' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
      if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const rtp = await getPlayerRTP(guestId);
      const result = spinWithRTP(rtp, bet, 'plinko', { risk: b.risk || 'medium' });
      if (result.win > 0) await creditWin(guestId, result.win, bet);
      await recordSession(guestId, bet, result.win);
      await pool.query(
        `INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['plinko', guestId, bet, result.win, result.mult, result.win > bet ? 'win' : 'lose', guestId]
      );
      const net = bet - result.win;
      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`,
        [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Plinko bet (${guestId})`]
      );
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, {
        ok: true, path: result.path, slot: result.slot,
        multiplier: result.mult, win: result.win,
        balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering
      });
    }

    // ============================================================
    // ========================= CASES ============================
    // ============================================================
    if (url === '/api/cases/open' && method === 'POST') {
      const b = await parseBody(req);
      const { guest_id, case_name } = b;
      if (!guest_id || !case_name) return sendJSON(res, 400, { error: 'no data' });
      const c = CASES[case_name];
      if (!c) return sendJSON(res, 400, { error: 'Кейс не найден' });
      const debited = await debitBet(guest_id, c.price);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const rtp = await getPlayerRTP(guest_id);
      const result = spinWithRTP(rtp, c.price, 'case', { caseName: case_name });
      const prize = result.prize;
      await creditWin(guest_id, prize, c.price);
      await recordSession(guest_id, c.price, prize);
      const net = c.price - prize;
      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
        [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Case ${case_name} (${guest_id})`]
      );
      const bal = await getBalance(guest_id);
      return sendJSON(res, 200, { ok: true, prize, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    // ============================================================
    // =================== ПОСЛЕДНИЕ ВЫИГРЫШИ =====================
    // ============================================================
    if (url === '/api/last-wins' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(50, parseInt(u.searchParams.get('limit'), 10) || 20);
      try {
        const r = await pool.query(`
          SELECT 'crash' AS game, guest_id AS player, amount AS bet, amount * cashout_mult AS win, ROUND(cashout_mult::numeric, 2) AS mult, created_at FROM crash_bets WHERE cashed_out = TRUE AND cashout_mult >= 2 AND guest_id NOT LIKE 'BOT%'
          UNION ALL
          SELECT game, player_name, bet, result AS win, CASE WHEN bet > 0 THEN ROUND((result / bet)::numeric, 2) ELSE 0 END AS mult, created_at FROM game_history WHERE result > bet AND result >= bet * 1.5 AND game IN ('miner','plinko','cases')
          ORDER BY created_at DESC LIMIT $1
        `, [limit]);
        let wins = r.rows;
        for (let i = 0; i < 5; i++) wins.push(generateBotWin());
        wins.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        return sendJSON(res, 200, wins.slice(0, limit));
      } catch (e) {
        const fakeWins = [];
        for (let i = 0; i < limit; i++) fakeWins.push(generateBotWin());
        return sendJSON(res, 200, fakeWins);
      }
    }

    // ============================================================
    // ==================== АДМИНКА: ДЕПОЗИТЫ =====================
    // ============================================================
    if (url === '/api/deposits' && method === 'GET') {
      const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }

    if (url === '/api/deposits' && method === 'POST') {
      const d = await parseBody(req);
      const amt = parseFloat(d.sum) || 0;
      if (amt < 100) return sendJSON(res, 400, { error: 'Мин 100 ₽' });
      const r = await pool.query(
        `INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [todayStr(), d.nick, d.email, d.sum, 'pending']
      );
      return sendJSON(res, 200, { ok: true, deposit: r.rows[0] });
    }

    if (url.startsWith('/api/deposits/') && method === 'PUT') {
      const id = url.split('/')[3];
      const d = await parseBody(req);
      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);
      if (d.status === 'approved') {
        const dep = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
        if (dep.rows.length) {
          const nick = dep.rows[0].nick;
          const sum = parseFloat(dep.rows[0].sum);
          await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE LOWER(name) = LOWER($2) OR id=$2', [sum, nick]);
        }
      }
      return sendJSON(res, 200, { ok: true });
    }

    // ============================================================
    // ==================== АДМИНКА: ВЫВОДЫ =======================
    // ============================================================
    if (url === '/api/withdrawals' && method === 'GET') {
      const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }

    if (url === '/api/withdrawals' && method === 'POST') {
      const w = await parseBody(req);
      const sum = Math.round((parseFloat(w.sum) || 0) * 100) / 100;
      if (sum < 500) return sendJSON(res, 400, { error: 'Мин 500 ₽' });
      const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) OR id=$1 LIMIT 1`, [w.nick]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Не найден' });
      const g = gRes.rows[0];
      const dep = parseFloat(g.deposit_balance) || 0;
      if (dep < sum) return sendJSON(res, 400, { error: `Доступно: ${dep.toFixed(2)} ₽` });
      await pool.query('UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2', [sum, g.id]);
      const fee = Math.round(sum * 0.15 * 100) / 100;
      const net = Math.round((sum - fee) * 100) / 100;
      const r = await pool.query(
        `INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [todayStr(), g.name, w.email || '', sum, fee, net, 'pending']
      );
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`, [todayStr(), sum, `Withdraw request (${g.name})`]);
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0] });
    }

    if (url.startsWith('/api/withdrawals/') && method === 'PUT') {
      const id = url.split('/')[3];
      const w = await parseBody(req);
      await pool.query('UPDATE withdrawals SET status=$1 WHERE id=$2', [w.status, id]);
      if (w.status === 'rejected') {
        const wd = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
        if (wd.rows.length) {
          await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE LOWER(name) = LOWER($2) OR id=$2', [parseFloat(wd.rows[0].sum), wd.rows[0].nick]);
        }
      }
      return sendJSON(res, 200, { ok: true });
    }

    // ============================================================
    // ================== АДМИНКА: КАССА (MANUAL) =================
    // ============================================================
    if (url === '/api/admin/house/add' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const amt = Math.round((parseFloat(b.amount) || 0) * 100) / 100;
      if (amt <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть > 0' });
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`,
        [todayStr(), amt, `ADMIN MANUAL: добавление в кассу (${b.note || 'без комментария'})`]);
      const house = await getHouseBalance();
      return sendJSON(res, 200, { ok: true, added: amt, treasury: house.balance });
    }

    if (url === '/api/admin/house/remove' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const amt = Math.round((parseFloat(b.amount) || 0) * 100) / 100;
      if (amt <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть > 0' });
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`,
        [todayStr(), amt, `ADMIN MANUAL: списание с кассы (${b.note || 'без комментария'})`]);
      const house = await getHouseBalance();
      return sendJSON(res, 200, { ok: true, removed: amt, treasury: house.balance });
    }

    if (url === '/api/admin/house/log' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      if (u.searchParams.get('pass') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const limit = Math.min(200, parseInt(u.searchParams.get('limit'), 10) || 50);
      const r = await pool.query(`SELECT id, date, type, sum, note, created_at FROM online ORDER BY id DESC LIMIT $1`, [limit]);
      return sendJSON(res, 200, r.rows);
    }

    // ============================================================
    // ================ АДМИНКА: СОЗДАНИЕ ИГРОКА ==================
    // ============================================================
    if (url === '/api/admin/guest/create' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });

      const id = String(b.id || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'Укажите ID' });
      if (id.length > 50) return sendJSON(res, 400, { error: 'ID слишком длинный (макс 50)' });
      if (!/^[A-Za-z0-9_\-\.]+$/.test(id)) return sendJSON(res, 400, { error: 'ID: только латиница, цифры, _ - .' });

      const name = String(b.name || id).trim().slice(0, 100) || id;
      const password = String(b.password || '1234').trim().slice(0, 50) || '1234';
      const rank = String(b.rank || 'Bronze').trim();
      const deposit = Math.round((parseFloat(b.deposit) || 0) * 100) / 100;
      const bonus = Math.round((parseFloat(b.bonus) || 0) * 100) / 100;
      const wagerMult = parseFloat(b.wager) || 5;
      const wagerReq = bonus * wagerMult;
      if (deposit < 0 || bonus < 0) return sendJSON(res, 400, { error: 'Суммы не могут быть отрицательными' });

      const exists = await pool.query('SELECT id FROM guests WHERE id=$1', [id]);
      if (exists.rows.length) return sendJSON(res, 400, { error: 'Игрок с таким ID уже существует' });

      try {
        await pool.query(
          `INSERT INTO guests
            (id, name, pass, rank, deposit_balance, bonus_balance, wagering_required, bonus_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, name, password, rank, deposit, bonus, wagerReq,
           bonus > 0 ? `Бонус при создании (×${wagerMult})` : null]
        );
        if (deposit > 0) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`,
          [todayStr(), deposit, `Admin created guest ${id} (deposit)`]);
        if (bonus > 0) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`,
          [todayStr(), bonus, `Admin created guest ${id} (bonus)`]);
        return sendJSON(res, 200, { ok: true, id, name, rank, deposit, bonus, wager_required: wagerReq });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }

    if (url === '/api/admin/guest/update' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const id = String(b.id || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'Укажите ID' });
      const fields = []; const values = []; let i = 1;
      if (b.name !== undefined) { fields.push(`name = $${i++}`); values.push(String(b.name).slice(0, 100)); }
      if (b.password !== undefined) { fields.push(`pass = $${i++}`); values.push(String(b.password).slice(0, 50)); }
      if (b.rank !== undefined) { fields.push(`rank = $${i++}`); values.push(String(b.rank)); }
      if (!fields.length) return sendJSON(res, 400, { error: 'Нет полей для обновления' });
      values.push(id);
      const r = await pool.query(`UPDATE guests SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, rank`, values);
      if (!r.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      return sendJSON(res, 200, { ok: true, guest: r.rows[0] });
    }

    // ============================================================
    // ==================== АДМИНКА: БОНУС ИГРОКУ =================
    // ============================================================
    if (url === '/api/admin/guest/bonus' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const amount = Math.round((parseFloat(b.amount) || 0) * 100) / 100;
      if (amount <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть > 0' });
      const guestKey = String(b.guest_id || b.nick || '').trim();
      if (!guestKey) return sendJSON(res, 400, { error: 'Укажите ID или имя игрока' });
      const gRes = await pool.query(`SELECT * FROM guests WHERE id=$1 OR LOWER(name) = LOWER($1) LIMIT 1`, [guestKey]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const guest = gRes.rows[0];
      const title = String(b.title || 'Бонус от админа').slice(0, 100);
      const wagerMult = parseFloat(b.wager) || 5;
      const wagerReq = amount * wagerMult;
      await pool.query(
        `UPDATE guests SET bonus_balance = COALESCE(bonus_balance,0) + $1,
         wagering_required = COALESCE(wagering_required,0) + $2, bonus_text = $3 WHERE id = $4`,
        [amount, wagerReq, title, guest.id]
      );
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`,
        [todayStr(), amount, `Admin bonus "${title}" to ${guest.id}`]);
      const bal = await getBalance(guest.id);
      return sendJSON(res, 200, {
        ok: true, guest_id: guest.id, guest_name: guest.name,
        bonus_added: amount, wagering_required: wagerReq,
        new_bonus_balance: bal.bonus, new_deposit_balance: bal.deposit,
        new_total_balance: bal.total
      });
    }

    if (url === '/api/admin/guest/balance' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      if (u.searchParams.get('pass') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const guestKey = u.searchParams.get('guest_id') || u.searchParams.get('nick');
      if (!guestKey) return sendJSON(res, 400, { error: 'Укажите ID или имя' });
      const gRes = await pool.query(
        `SELECT id, name, deposit_balance, bonus_balance, wagering_required, wagering_done
         FROM guests WHERE id=$1 OR LOWER(name) = LOWER($1) LIMIT 1`, [guestKey]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const g = gRes.rows[0];
      return sendJSON(res, 200, {
        id: g.id, name: g.name,
        deposit: parseFloat(g.deposit_balance) || 0,
        bonus: parseFloat(g.bonus_balance) || 0,
        wagering_required: parseFloat(g.wagering_required) || 0,
        wagering_done: parseFloat(g.wagering_done) || 0
      });
    }

    // ============================================================
    // ========================== ГОСТИ ===========================
    // ============================================================
    if (url === '/api/guests' && method === 'GET') {
      const r = await pool.query('SELECT * FROM guests ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }

    if (url === '/api/guest/me' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
      const guest = r.rows[0];
      return sendJSON(res, 200, {
        guest,
        balance: {
          total: (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0),
          deposit: parseFloat(guest.deposit_balance) || 0,
          bonus: parseFloat(guest.bonus_balance) || 0
        },
        wagering: {
          required: parseFloat(guest.wagering_required) || 0,
          done: parseFloat(guest.wagering_done) || 0,
          left: Math.max(0, (parseFloat(guest.wagering_required) || 0) - (parseFloat(guest.wagering_done) || 0))
        },
        rtp: parseFloat(guest.rtp) || 0.80
      });
    }

    if (url === '/api/guest/register' && method === 'POST') {
      const b = await parseBody(req);
      const id = String(b.id || '').trim();
      const name = String(b.name || id).trim();
      const pass = String(b.pass || '1234').trim();
      if (!id) return sendJSON(res, 400, { error: 'Введите ID' });
      const exists = await pool.query('SELECT id FROM guests WHERE id=$1', [id]);
      if (exists.rows.length) return sendJSON(res, 400, { error: 'Такой ID уже есть' });
      await pool.query(
        `INSERT INTO guests (id, name, pass, rank, bonus_balance, deposit_balance) VALUES ($1, $2, $3, 'Bronze', 0, 0)`,
        [id, name, pass]
      );
      return sendJSON(res, 200, { ok: true, id, name });
    }

    if (url === '/api/guest/login' && method === 'POST') {
      const { id, pass } = await parseBody(req);
      if (!id || !pass) return sendJSON(res, 400, { error: 'Введите данные' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (!r.rows.length) return sendJSON(res, 401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      if (String(pass) !== String(g.pass || '1234')) return sendJSON(res, 401, { error: 'Неверный пароль' });
      return sendJSON(res, 200, { ok: true, guest: g });
    }

    // ============================================================
    // ============ АКТИВАЦИЯ ПРОМОКОДА (ИГРОК) ===================
    // ============================================================
    if (url === '/api/promo/activate' && method === 'POST') {
      const b = await parseBody(req);
      const code = String(b.code || '').trim().toUpperCase();
      const guestId = String(b.guest_id || '').trim();
      if (!code || !guestId) return sendJSON(res, 400, { error: 'Введите код' });

      const p = await pool.query(`SELECT * FROM promo_codes WHERE code=$1 AND active=TRUE`, [code]);
      if (!p.rows.length) return sendJSON(res, 400, { error: 'Промокод не найден' });
      const promo = p.rows[0];
      if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
        return sendJSON(res, 400, { error: 'Промокод уже использован' });
      }
      const gRes = await pool.query('SELECT * FROM guests WHERE id=$1', [guestId]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });

      const amount = parseFloat(promo.value) || 0;
      const wagerReq = amount * 5;

      await pool.query(
        `UPDATE guests SET bonus_balance = COALESCE(bonus_balance,0) + $1,
         wagering_required = COALESCE(wagering_required,0) + $2, bonus_text = $3 WHERE id = $4`,
        [amount, wagerReq, `Промокод ${code}`, guestId]
      );
      await pool.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id=$1', [promo.id]);
      await pool.query(
        `INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`,
        [todayStr(), amount, `Promo ${code} activated by ${guestId}`]
      );
      return sendJSON(res, 200, { ok: true, amount, wager: wagerReq });
    }

    // ============================================================
    // =================== АДМИНКА: СТАТИСТИКА ====================
    // ============================================================
    if (url === '/api/admin/house/stats' && method === 'GET') {
      const r = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'доход' THEN sum ELSE 0 END), 0)::numeric AS income,
          COALESCE(SUM(CASE WHEN type = 'расход' THEN sum ELSE 0 END), 0)::numeric AS expense
        FROM online
      `);
      const income = parseFloat(r.rows[0].income) || 0;
      const expense = parseFloat(r.rows[0].expense) || 0;
      return sendJSON(res, 200, {
        treasury: income - expense,
        today: { turnover: income + expense, expense }
      });
    }

    if (url === '/api/admin/rtp-check' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guestId = u.searchParams.get('id');
      if (guestId) {
        const r = await pool.query('SELECT rtp, session_profit, session_turnover FROM guests WHERE id=$1', [guestId]);
        return sendJSON(res, 200, r.rows[0] || {});
      }
      const r = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type='доход' THEN sum ELSE 0 END), 0)::numeric AS income,
          COALESCE(SUM(CASE WHEN type='расход' THEN sum ELSE 0 END), 0)::numeric AS expense
        FROM online
      `);
      const income = parseFloat(r.rows[0].income) || 0;
      const expense = parseFloat(r.rows[0].expense) || 0;
      const turnover = income + expense;
      const realRTP = turnover > 0 ? expense / turnover : 0;
      return sendJSON(res, 200, {
        turnover, expense, income,
        real_rtp: Math.round(realRTP * 10000) / 100 + '%',
        house_edge: Math.round((1 - realRTP) * 10000) / 100 + '%'
      });
    }

    // ============================================================
    // ==================== АДМИНКА: ПРОМОКОДЫ ====================
    // ============================================================
    if (url === '/api/admin/promos' && method === 'GET') {
      const r = await pool.query('SELECT * FROM promo_codes ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }

    if (url === '/api/admin/promo/create' && method === 'POST') {
      const b = await parseBody(req);
      if (b.pass !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const code = String(b.code || '').trim().toUpperCase();
      const value = parseFloat(b.value) || 0;
      if (code.length < 3) return sendJSON(res, 400, { error: 'Короткий код' });
      if (value <= 0) return sendJSON(res, 400, { error: 'Сумма > 0' });
      try {
        const r = await pool.query(
          `INSERT INTO promo_codes (code, type, value, min_deposit, max_uses, used_count, active) VALUES ($1, 'deposit_bonus', $2, $3, $4, 0, TRUE) RETURNING *`,
          [code, value, parseFloat(b.min_deposit) || 0, parseInt(b.max_uses) || 0]
        );
        return sendJSON(res, 200, { ok: true, promo: r.rows[0] });
      } catch (e) {
        if (e.code === '23505') return sendJSON(res, 400, { error: 'Такой код уже есть' });
        return sendJSON(res, 500, { error: e.message });
      }
    }

    // ============================================================
    // ==================== АДМИНКА: ИСТОРИЯ ======================
    // ============================================================
    if (url === '/api/admin/history' && method === 'GET') {
      const r = await pool.query(`
        SELECT game, player_name, bet, result, multiplier, created_at
        FROM game_history ORDER BY created_at DESC LIMIT 100
      `);
      return sendJSON(res, 200, r.rows);
    }

    // ============================================================
    // ==================== ДИЛЕР =================================
    // ============================================================
    if (url === '/api/dealer/login' && method === 'POST') {
      const { login, pass } = await parseBody(req);
      if (!login || !pass) return sendJSON(res, 400, { error: 'Введите данные' });
      const r = await pool.query('SELECT * FROM dealers WHERE login=$1 AND pass=$2', [login, pass]);
      if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
      return sendJSON(res, 200, { ok: true, dealer: { id: r.rows[0].id, name: r.rows[0].name } });
    }

    // ============================================================
    // ==================== РАЗДАЧА СТАТИКИ =======================
    // ============================================================
    let file = url === '/' ? '/index.html' : decodeURIComponent(url);
    const safeRelative = path.normalize(file).replace(/^(\.\.[\/\\])+/, '').replace(/^[\/\\]+/, '');
    const filePath = path.join(__dirname, safeRelative);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2'
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
    return;

  } catch (e) {
    console.error('Ошибка сервера:', e.message);
    try { sendJSON(res, 500, { error: e.message }); } catch(err) {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер на порту ${PORT}`);
});
