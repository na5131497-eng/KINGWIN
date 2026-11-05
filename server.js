const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

let DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://neondb_owner:npg_ClW25VuNgUSc@ep-delicate-sea-beqrez4i.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';

if (DATABASE_URL.includes('sslmode=require')) {
  DATABASE_URL = DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full');
}
if (!DATABASE_URL.includes('sslmode=')) {
  DATABASE_URL += (DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=verify-full';
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 10
});

pool.on('error', (err) => {
  console.error('PG Pool error:', err.message);
});

/* ---------- Конфиг ---------- */
const POINTS_PER_RUB = 0.2;

const RANKS = {
  Bronze:   { min: 0,     gift: 0    },
  Silver:   { min: 100,   gift: 50   },
  Gold:     { min: 300,   gift: 200  },
  Platinum: { min: 600,   gift: 500  },
  Diamond:  { min: 1000,  gift: 1000 },
  VIP:      { min: 1500,  gift: 3000 }
};
const RANK_ORDER = ['Bronze','Silver','Gold','Platinum','Diamond','VIP'];

/* ---------- Джекпот ---------- */
const JACKPOT_MAX = 1000;
const JACKPOT_TICK_MS = 2300;
const JACKPOT_PER_TICK = 0.064;

function rankByPoints(p){
  if (p >= RANKS.VIP.min)      return 'VIP';
  if (p >= RANKS.Diamond.min)  return 'Diamond';
  if (p >= RANKS.Platinum.min) return 'Platinum';
  if (p >= RANKS.Gold.min)     return 'Gold';
  if (p >= RANKS.Silver.min)   return 'Silver';
  return 'Bronze';
}

async function getActualJackpot() {
  try {
    const jpRes = await pool.query(`SELECT value FROM settings WHERE key = 'jackpot'`);
    const tickRes = await pool.query(`SELECT value FROM settings WHERE key = 'jackpot_last_tick'`);
    let currentJP = parseFloat(jpRes.rows[0]?.value || 0);
    let lastTick = parseInt(tickRes.rows[0]?.value || Date.now());
    const now = Date.now();
    if (now > lastTick) {
      const ticksMissed = Math.floor((now - lastTick) / JACKPOT_TICK_MS);
      if (ticksMissed > 0) {
        currentJP += ticksMissed * JACKPOT_PER_TICK;
        if (currentJP >= JACKPOT_MAX) currentJP = 0;
        const newLastTick = lastTick + (ticksMissed * JACKPOT_TICK_MS);
        await pool.query(`UPDATE settings SET value = $1 WHERE key = 'jackpot'`, [currentJP.toString()]);
        await pool.query(`UPDATE settings SET value = $1 WHERE key = 'jackpot_last_tick'`, [newLastTick.toString()]);
      }
    }
    return currentJP;
  } catch (e) {
    console.error('getActualJackpot error:', e.message);
    return 0;
  }
}

/* ==========================================
   CRASH — глобальный раунд
   ========================================== */
const CRASH_WAIT_MS = 5000;
const CRASH_CRASH_PAUSE = 3000;

let crashState = {
  roundId: null,
  crashPoint: 1,
  startTime: 0,
  status: 'idle'
};
let crashTimeouts = [];

function crashClearTimers() {
  crashTimeouts.forEach(t => clearTimeout(t));
  crashTimeouts = [];
}

function crashGeneratePoint() {
  const r = Math.random();
  if (r < 0.10) return Math.max(1.00, 1 + Math.random() * 0.10);
  if (r < 0.60) return 1.10 + Math.random() * 0.90;
  if (r < 0.90) return 2.00 + Math.random() * 8.00;
  return 10.00 + Math.random() * 90.00;
}

async function crashStartRound() {
  try {
    crashClearTimers();
    const cp = crashGeneratePoint();
    const r = await pool.query(
      `INSERT INTO crash_rounds (crash_point, status) VALUES ($1, 'waiting') RETURNING id`,
      [cp]
    );
    crashState.roundId = r.rows[0].id;
    crashState.crashPoint = cp;
    crashState.startTime = 0;
    crashState.status = 'waiting';
    console.log('CRASH round #' + crashState.roundId + ' waiting, point=' + cp.toFixed(2));
    crashTimeouts.push(setTimeout(() => crashStartFlight(), CRASH_WAIT_MS));
  } catch (e) {
    console.error('crashStartRound:', e.message);
    crashTimeouts.push(setTimeout(() => crashStartRound(), 3000));
  }
}

async function crashStartFlight() {
  try {
    crashState.status = 'flying';
    crashState.startTime = Date.now();
    await pool.query(
      `UPDATE crash_rounds SET status='flying', start_time=$1 WHERE id=$2`,
      [crashState.startTime, crashState.roundId]
    );
    console.log('CRASH round #' + crashState.roundId + ' FLYING');
    const msToCrash = Math.log(crashState.crashPoint) / Math.log(1.00006);
    crashTimeouts.push(setTimeout(() => crashEndRound(), Math.max(msToCrash, 200)));
  } catch (e) {
    console.error('crashStartFlight:', e.message);
  }
}

async function crashEndRound() {
  try {
    crashState.status = 'crashed';
    const endTime = Date.now();
    await pool.query(
      `UPDATE crash_rounds SET status='crashed', end_time=$1 WHERE id=$2`,
      [endTime, crashState.roundId]
    );
    console.log('CRASH round #' + crashState.roundId + ' CRASHED at ' + crashState.crashPoint.toFixed(2));
    crashTimeouts.push(setTimeout(() => crashStartRound(), CRASH_CRASH_PAUSE));
  } catch (e) {
    console.error('crashEndRound:', e.message);
  }
}

/* ---------- initDB ---------- */
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY, date TEXT, nick TEXT, decks INTEGER,
        dep NUMERIC DEFAULT 0, out_sum NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0,
        net NUMERIC DEFAULT 0, result NUMERIC DEFAULT 0, dealer TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS baccarat (
        id SERIAL PRIMARY KEY, date TEXT, player TEXT, bet TEXT, sum NUMERIC DEFAULT 0,
        result TEXT, dealer TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT,
        sum NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT,
        sum NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY, date TEXT, dealer TEXT, sum NUMERIC DEFAULT 0, note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY, nick TEXT UNIQUE, vip BOOLEAN DEFAULT FALSE,
        blocked BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY, name TEXT, provider TEXT,
        min_sum NUMERIC DEFAULT 10, max_sum NUMERIC DEFAULT 100,
        active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit (
        id SERIAL PRIMARY KEY, time TEXT, user_name TEXT, action TEXT, details TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT, role TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealers (
        id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS online (
        id SERIAL PRIMARY KEY, date TEXT, type TEXT, sum NUMERIC DEFAULT 0, note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT
      );
      CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY, name TEXT, rank TEXT DEFAULT 'Bronze',
        points INTEGER DEFAULT 0, visits INTEGER DEFAULT 0,
        bonus_text TEXT, bonus_code TEXT,
        pass TEXT DEFAULT '1234',
        bonus_balance NUMERIC DEFAULT 0,
        wagering_required NUMERIC DEFAULT 0,
        wagering_done NUMERIC DEFAULT 0,
        last_rank TEXT DEFAULT 'Bronze',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_rounds (
        id SERIAL PRIMARY KEY,
        crash_point NUMERIC NOT NULL,
        start_time BIGINT,
        end_time BIGINT,
        status TEXT DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_bets (
        id SERIAL PRIMARY KEY,
        round_id INTEGER REFERENCES crash_rounds(id) ON DELETE CASCADE,
        player_id TEXT,
        player_name TEXT,
        amount NUMERIC NOT NULL,
        cashout_mult NUMERIC,
        cashed_out BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const cols = [
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS pass TEXT DEFAULT '1234'`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_required NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_done NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_rank TEXT DEFAULT 'Bronze'`
    ];
    for (const c of cols){ try { await pool.query(c); } catch(e){} }

    const own = await pool.query(`SELECT * FROM employees WHERE role = 'owner'`);
    if(own.rows.length === 0){
      await pool.query(`INSERT INTO employees (name, login, pass, role) VALUES ($1,$2,$3,$4)`,
        ['Владелец', 'Owner', '56UpahoS', 'owner']);
    } else {
      await pool.query(`UPDATE employees SET login = $1, pass = $2 WHERE role = 'owner'`,
        ['Owner', '56UpahoS']);
    }

    const dlCount = await pool.query(`SELECT COUNT(*) FROM dealers`);
    if(parseInt(dlCount.rows[0].count,10) === 0){
      await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1,$2,$3)`,
        ['Дилер', 'dealer', '56UpahoS']);
    }

    const gCnt = await pool.query(`SELECT COUNT(*) FROM games`);
    if(parseInt(gCnt.rows[0].count,10) === 0){
      const def = [
        ['Блэкджек 6 колод', 'Casino', 10, 100],
        ['Блэкджек 4 колоды', 'Casino', 10, 100],
        ['Блэкджек 2 колоды', 'Casino', 10, 80],
        ['Блэкджек 1 колода', 'Casino', 10, 65],
        ['Баккара 6 колод', 'Casino', 10, 100]
      ];
      for(const g of def){
        await pool.query(`INSERT INTO games (name, provider, min_sum, max_sum) VALUES ($1,$2,$3,$4)`, g);
      }
    }

    const jpCheck = await pool.query(`SELECT * FROM settings WHERE key IN ('jackpot', 'jackpot_last_tick')`);
    if(!jpCheck.rows.find(r => r.key === 'jackpot')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot', '0')`);
    }
    if(!jpCheck.rows.find(r => r.key === 'jackpot_last_tick')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot_last_tick', $1)`, [Date.now().toString()]);
    }

    console.log('База готова');
    crashStartRound();
  } catch (e) {
    console.error('Ошибка initDB:', e.message);
    setTimeout(initDB, 5000);
  }
}
initDB();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
function parseBody(req){
  return new Promise((resolve)=>{
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch(e){ resolve({}); } });
  });
}

/* ---------- Начисление баллов + подарки ---------- */
async function accruePointsByNick(nick, rubAmount, source){
  if(!nick || !rubAmount || rubAmount <= 0) return null;
  const g = await pool.query(
    `SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [nick.trim()]
  );
  if(g.rows.length === 0) return null;
  const guest = g.rows[0];

  const addPoints = Math.floor(rubAmount * POINTS_PER_RUB);
  if(addPoints <= 0) return null;

  const oldPoints = guest.points || 0;
  const newPoints = oldPoints + addPoints;
  const prevRank = guest.rank || 'Bronze';
  const newRank = rankByPoints(newPoints);

  let giftMoney = 0;
  let giftText = guest.bonus_text || '';
  let giftCode = guest.bonus_code || '';
  const prevIdx = RANK_ORDER.indexOf(prevRank);
  const newIdx = RANK_ORDER.indexOf(newRank);
  if (newIdx > prevIdx){
    for (let i = prevIdx + 1; i <= newIdx; i++){
      giftMoney += RANKS[RANK_ORDER[i]].gift;
    }
    giftText = `Поздравляем с достижением ранга ${newRank}! Вам подарок ${giftMoney} бонусных рублей.`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }

  const addWagerReq = giftMoney * 5;
  const addWagerDone = addPoints;

  await pool.query(`
    UPDATE guests SET
      points = $1,
      rank = $2,
      last_rank = $3,
      bonus_text = $4,
      bonus_code = $5,
      bonus_balance = bonus_balance + $6,
      wagering_required = wagering_required + $7,
      wagering_done = wagering_done + $8
    WHERE id = $9
  `, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReq, addWagerDone, guest.id]);

  return { guestId: guest.id, addPoints, newPoints, newRank, giftMoney, source };
}

/* ---------- Начисление баланса гостю по нику ---------- */
async function addBalanceByNick(nick, amount){
  if(!nick || !amount) return false;
  const g = await pool.query(
    `SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [String(nick).trim()]
  );
  if(g.rows.length === 0) return false;
  await pool.query(
    `UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`,
    [parseFloat(amount) || 0, g.rows[0].id]
  );
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    /* ДЖЕКПОТ */
    if(url === '/api/jackpot' && method === 'GET'){
      const jackpot = await getActualJackpot();
      return sendJSON(res, 200, { jackpot });
    }

    /* ==========================================
       CRASH API
       ========================================== */
    if (url === '/api/crash/current' && method === 'GET') {
      let multiplier = 1;
      if (crashState.status === 'flying' && crashState.startTime) {
        const elapsed = Date.now() - crashState.startTime;
        multiplier = Math.pow(1.00006, elapsed);
        if (multiplier >= crashState.crashPoint) multiplier = crashState.crashPoint;
      } else if (crashState.status === 'crashed') {
        multiplier = crashState.crashPoint;
      }

      let bets = [];
      if (crashState.roundId) {
        try {
          const betsRes = await pool.query(
            `SELECT id, player_id, player_name, amount, cashout_mult, cashed_out
             FROM crash_bets WHERE round_id=$1 ORDER BY id ASC`,
            [crashState.roundId]
          );
          bets = betsRes.rows;
        } catch(e) {}
      }

      let history = [];
      try {
        const histRes = await pool.query(
          `SELECT crash_point FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT 15`
        );
        history = histRes.rows.map(r => parseFloat(r.crash_point));
      } catch(e) {}

      return sendJSON(res, 200, {
        roundId: crashState.roundId,
        status: crashState.status,
        startTime: crashState.startTime,
        crashPoint: crashState.status === 'crashed' ? crashState.crashPoint : null,
        multiplier,
        bets,
        history
      });
    }

    if (url === '/api/crash/bet' && method === 'POST') {
      const b = await parseBody(req);
      if (crashState.status !== 'waiting') {
        return sendJSON(res, 400, { error: 'Раунд уже начался' });
      }
      const amt = parseFloat(b.amount) || 0;
      if (amt < 10) return sendJSON(res, 400, { error: 'Мин. ставка 10 ₽' });
      if (amt > 100) return sendJSON(res, 400, { error: 'Макс. ставка 100 ₽' });

      if (b.player_id) {
        const gRes = await pool.query(`SELECT * FROM guests WHERE id=$1`, [String(b.player_id)]);
        if (gRes.rows.length > 0) {
          const bal = parseFloat(gRes.rows[0].bonus_balance) || 0;
          if (bal < amt) {
            return sendJSON(res, 400, { error: 'Недостаточно бонусных рублей' });
          }
          await pool.query(
            `UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2`,
            [amt, String(b.player_id)]
          );
        }
      }

      const r = await pool.query(
        `INSERT INTO crash_bets (round_id, player_id, player_name, amount)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [crashState.roundId, b.player_id || null, b.player_name || 'Гость', amt]
      );
      return sendJSON(res, 200, { ok: true, bet: r.rows[0] });
    }

    if (url === '/api/crash/cashout' && method === 'POST') {
      const b = await parseBody(req);
      if (crashState.status !== 'flying') {
        return sendJSON(res, 400, { error: 'Не в фазе полёта' });
      }
      const elapsed = Date.now() - crashState.startTime;
      let mult = Math.pow(1.00006, elapsed);
      if (mult >= crashState.crashPoint) {
        return sendJSON(res, 400, { error: 'Поздно — уже краш' });
      }

      const betRes = await pool.query(
        `SELECT * FROM crash_bets WHERE id=$1 AND round_id=$2 AND cashed_out=false`,
        [b.bet_id, crashState.roundId]
      );
      if (!betRes.rows.length) {
        return sendJSON(res, 400, { error: 'Ставка не найдена' });
      }
      const bet = betRes.rows[0];
      const winAmount = (parseFloat(bet.amount) * mult);

      await pool.query(
        `UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2`,
        [mult, b.bet_id]
      );

      if (bet.player_id) {
        await pool.query(
          `UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`,
          [winAmount, bet.player_id]
        );
      }

      return sendJSON(res, 200, { ok: true, mult, win: winAmount });
    }

    /* ГОСТИ */
    if(url === '/api/guests' && method === 'GET'){
      const r = await pool.query('SELECT * FROM guests ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/guests' && method === 'POST'){
      const g = await parseBody(req);
      const cardId = g.id || Math.floor(10000000 + Math.random() * 90000000).toString();
      const r = await pool.query(
        `INSERT INTO guests (id, name, rank, points, visits, bonus_text, bonus_code, pass)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [cardId, g.name, g.rank || 'Bronze', g.points || 0, g.visits || 0,
         g.bonus_text || '', g.bonus_code || '',
         g.pass || '1234']
      );
      return sendJSON(res, 200, { ok: true, guest: r.rows[0] });
    }
    if(url === '/api/guests/delete' && method === 'POST'){
      const g = await parseBody(req);
      await pool.query('DELETE FROM guests WHERE id=$1', [g.id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url === '/api/guests/update' && method === 'POST'){
      const g = await parseBody(req);
      if(!g.id) return sendJSON(res, 400, { error: 'no id' });
      try {
        await pool.query(`
          UPDATE guests SET
            name = $1, rank = $2, pass = $3, bonus_text = $4,
            bonus_code = $5, bonus_balance = $6
          WHERE id = $7
        `, [g.name, g.rank, g.pass, g.bonus_text, g.bonus_code, g.bonus_balance || 0, g.id]);
        return sendJSON(res, 200, { ok: true });
      } catch(e){ return sendJSON(res, 500, { error: e.message }); }
    }
    if(url === '/api/guests/withdraw-deduct' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      await pool.query(
        'UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2',
        [parseFloat(sum) || 0, id]
      );
      return sendJSON(res, 200, { ok: true });
    }

    /* ЛОГИН ГОСТЯ */
    if(url === '/api/guest/login' && method === 'POST'){
      const { id, pass } = await parseBody(req);
      if(!id || !pass) return sendJSON(res, 400, { error: 'Введите номер карты и пароль' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id).trim()]);
      if(r.rows.length === 0) return sendJSON(res, 401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      const realPass = g.pass || '1234';
      if(String(pass) !== String(realPass)) return sendJSON(res, 401, { error: 'Неверный пароль' });
      await pool.query('UPDATE guests SET visits = visits + 1 WHERE id=$1', [g.id]);
      return sendJSON(res, 200, { ok: true, guest: g });
    }

    if(url === '/api/guest/me' && method === 'GET'){
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, { guest: r.rows[0] });
    }

    if(url === '/api/guest/withdraw' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const amt = parseFloat(sum) || 0;
      if(amt <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть больше 0' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'Карта не найдена' });
      const g = r.rows[0];
      const balance = parseFloat(g.bonus_balance) || 0;
      const required = parseFloat(g.wagering_required) || 0;
      const done = parseFloat(g.wagering_done) || 0;
      if (done < required) return sendJSON(res, 400, { error: 'Сначала выполните условие (отыгрыш)' });
      if (amt > balance) return sendJSON(res, 400, { error: 'Недостаточно бонусных рублей' });
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2', [amt, id]);
      const w = await pool.query(
        `INSERT INTO withdrawals (date, nick, email, sum, fee, net, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [new Date().toISOString().slice(0,10), g.name, '', amt, 0, amt, 'pending']
      );
      return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] });
    }

    /* СЕССИИ */
    if(url === '/api/sessions' && method === 'GET'){
      const r = await pool.query('SELECT * FROM sessions ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/sessions' && method === 'POST'){
      const s = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO sessions (date,nick,decks,dep,out_sum,fee,net,result,dealer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [s.date,s.nick,s.decks,s.dep,s.outSum,s.fee,s.net,s.result,s.dealer]);
      const accrued = await accruePointsByNick(s.nick, parseFloat(s.dep) || 0, 'blackjack');
      let currentJP = await getActualJackpot();
      if(s.winJackpot){ currentJP = 0; }
      else {
        currentJP += Math.max(1, (parseFloat(s.dep)||0) * 0.15);
        if (currentJP >= JACKPOT_MAX) currentJP = 0;
      }
      await pool.query(`UPDATE settings SET value=$1 WHERE key='jackpot'`, [currentJP.toString()]);
      await pool.query(`UPDATE settings SET value=$1 WHERE key='jackpot_last_tick'`, [Date.now().toString()]);
      return sendJSON(res, 200, { ok: true, session: r.rows[0], jackpot: currentJP, accrued });
    }
    if(url.startsWith('/api/sessions/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM sessions WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* БАККАРА */
    if(url === '/api/baccarat' && method === 'GET'){
      const r = await pool.query('SELECT * FROM baccarat ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/baccarat' && method === 'POST'){
      const b = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO baccarat (date,player,bet,sum,result,dealer)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [b.date,b.player,b.bet,b.sum,b.result,b.dealer]);
      const accrued = await accruePointsByNick(b.player, parseFloat(b.sum) || 0, 'baccarat');
      return sendJSON(res, 200, { ok: true, baccarat: r.rows[0], accrued });
    }
    if(url.startsWith('/api/baccarat/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM baccarat WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ДЕПОЗИТЫ */
    if(url === '/api/deposits' && method === 'GET'){
      const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/deposits' && method === 'POST'){
      const d = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [d.date,d.nick,d.email,d.sum,d.status||'pending']);
      return sendJSON(res, 200, { ok: true, deposit: r.rows[0] });
    }
    if(url.startsWith('/api/deposits/') && method === 'PUT'){
      const id = url.split('/')[3];
      const d = await parseBody(req);

      const beforeRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if(beforeRes.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const dep = beforeRes.rows[0];

      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);

      if(d.status === 'approved' && dep.status !== 'approved'){
        const ok = await addBalanceByNick(dep.nick, dep.sum);
        if(!ok) console.warn('Депозит #' + id + ' подтверждён, но гость "' + dep.nick + '" не найден — баланс не начислен');
      }

      if(d.status === 'rejected' && dep.status === 'approved'){
        const g = await pool.query(
          'SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [dep.nick]
        );
        if(g.rows.length > 0){
          await pool.query(
            'UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2',
            [parseFloat(dep.sum) || 0, g.rows[0].id]
          );
        }
      }

      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/deposits/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM deposits WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ВЫВОДЫ */
    if(url === '/api/withdrawals' && method === 'GET'){
      const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/withdrawals' && method === 'POST'){
      const w = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO withdrawals (date,nick,email,sum,fee,net,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [w.date,w.nick,w.email,w.sum,w.fee,w.net,w.status||'pending']);
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0] });
    }
    if(url.startsWith('/api/withdrawals/') && method === 'PUT'){
      const id = url.split('/')[3];
      const w = await parseBody(req);
      await pool.query('UPDATE withdrawals SET status=$1 WHERE id=$2', [w.status, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/withdrawals/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM withdrawals WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ВЫПЛАТЫ */
    if(url === '/api/payouts' && method === 'GET'){
      const r = await pool.query('SELECT * FROM payouts ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/payouts' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO payouts (date,dealer,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`,
        [p.date,p.dealer,p.sum,p.note]);
      return sendJSON(res, 200, { ok: true, payout: r.rows[0] });
    }
    if(url.startsWith('/api/payouts/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM payouts WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ИГРОКИ */
    if(url === '/api/players' && method === 'GET'){
      const r = await pool.query('SELECT * FROM players ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/players' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO players (nick,vip,blocked) VALUES ($1,$2,$3)
         ON CONFLICT (nick) DO UPDATE SET vip=EXCLUDED.vip, blocked=EXCLUDED.blocked RETURNING *`,
        [p.nick,p.vip||false,p.blocked||false]);
      return sendJSON(res, 200, { ok: true, player: r.rows[0] });
    }

    /* ИГРЫ */
    if(url === '/api/games' && method === 'GET'){
      const r = await pool.query('SELECT * FROM games ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/games' && method === 'POST'){
      const g = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO games (name,provider,min_sum,max_sum,active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [g.name,g.provider,g.min,g.max,true]);
      return sendJSON(res, 200, { ok: true, game: r.rows[0] });
    }
    if(url.startsWith('/api/games/') && method === 'PUT'){
      const id = url.split('/')[3];
      const g = await parseBody(req);
      await pool.query('UPDATE games SET active=$1 WHERE id=$2', [g.active, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/games/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM games WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* АУДИТ */
    if(url === '/api/audit' && method === 'GET'){
      const r = await pool.query('SELECT * FROM audit ORDER BY id DESC LIMIT 500');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/audit' && method === 'POST'){
      const a = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO audit (time,user_name,action,details) VALUES ($1,$2,$3,$4) RETURNING *`,
        [a.time,a.user,a.action,a.details]);
      return sendJSON(res, 200, { ok: true, audit: r.rows[0] });
    }
    if(url === '/api/audit' && method === 'DELETE'){
      await pool.query('DELETE FROM audit');
      return sendJSON(res, 200, { ok: true });
    }

    /* СОТРУДНИКИ */
    if(url === '/api/employees' && method === 'GET'){
      const r = await pool.query('SELECT id,name,login,role FROM employees ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/employees' && method === 'POST'){
      const e = await parseBody(req);
      try {
        const r = await pool.query(
          `INSERT INTO employees (name,login,pass,role) VALUES ($1,$2,$3,$4) RETURNING id,name,login,role`,
          [e.name,e.login,e.pass,e.role]);
        return sendJSON(res, 200, { ok: true, employee: r.rows[0] });
      } catch(err){ return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if(url.startsWith('/api/employees/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM employees WHERE id=$1 AND role!=$2', [id, 'owner']);
      return sendJSON(res, 200, { ok: true });
    }

    /* ДИЛЕРЫ */
    if(url === '/api/dealers' && method === 'GET'){
      const r = await pool.query('SELECT id,name,login FROM dealers ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/dealers' && method === 'POST'){
      const d = await parseBody(req);
      try {
        const r = await pool.query(
          `INSERT INTO dealers (name,login,pass) VALUES ($1,$2,$3) RETURNING id,name,login`,
          [d.name,d.login,d.pass]);
        return sendJSON(res, 200, { ok: true, dealer: r.rows[0] });
      } catch(err){ return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if(url.startsWith('/api/dealers/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM dealers WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ОНЛАЙН */
    if(url === '/api/online' && method === 'GET'){
      const r = await pool.query('SELECT * FROM online ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/online' && method === 'POST'){
      const o = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO online (date,type,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`,
        [o.date,o.type,o.sum,o.note]);
      return sendJSON(res, 200, { ok: true, online: r.rows[0] });
    }
    if(url.startsWith('/api/online/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM online WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ЛОГИН */
    if(url === '/api/login' && method === 'POST'){
      const { login, pass, type } = await parseBody(req);
      if(type === 'dealer'){
        const r = await pool.query('SELECT * FROM dealers WHERE login=$1 AND pass=$2', [login, pass]);
        if(r.rows.length === 0) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
        return sendJSON(res, 200, { ok: true, dealer: { id: r.rows[0].id, name: r.rows[0].name } });
      } else {
        const r = await pool.query('SELECT * FROM employees WHERE login=$1 AND pass=$2', [login, pass]);
        if(r.rows.length === 0) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
        return sendJSON(res, 200, { ok: true, employee: { id: r.rows[0].id, name: r.rows[0].name, role: r.rows[0].role } });
      }
    }

    /* СТАТИКА */
    let file = url === '/' ? '/index.html' : url;
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);

  } catch (e) {
    console.error('Ошибка сервера:', e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Сервер запущен на порту ' + PORT);
  console.log('  Админ:   /admin.html');
  console.log('  Дилер:   /dealer.html');
  console.log('  Джекпот: /jackpot.html');
  console.log('  Crash:   /crash.html');
  console.log('  Гость:   /profile2.html');
  console.log('');
});
