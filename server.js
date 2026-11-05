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
const RANK_INDEX = { 'Bronze': 1, 'Silver': 2, 'Gold': 3, 'Platinum': 4, 'Diamond': 5, 'VIP': 6 };

function rankByPoints(p){
  if (p >= RANKS.VIP.min)      return 'VIP';
  if (p >= RANKS.Diamond.min)  return 'Diamond';
  if (p >= RANKS.Platinum.min) return 'Platinum';
  if (p >= RANKS.Gold.min)     return 'Gold';
  if (p >= RANKS.Silver.min)   return 'Silver';
  return 'Bronze';
}

/* ---------- DAILY & WHEEL конфиг ---------- */
const DAILY_REWARDS = [15, 30, 40, 50, 60, 60, 100]; // Д1..Д7
const WHEEL_PRIZES = [
  { index: 0, label: '10 баллов',  type: 'points', value: 10,  weight: 26, color: '#00e5ff' },
  { index: 1, label: '10 ₽',       type: 'money',  value: 10,  weight: 22, color: '#3fbf7f' },
  { index: 2, label: '25 баллов',  type: 'points', value: 25,  weight: 18, color: '#d4af37' },
  { index: 3, label: '50 ₽',       type: 'money',  value: 50,  weight: 14, color: '#ff8a8a' },
  { index: 4, label: '100 ₽',      type: 'money',  value: 100, weight: 10, color: '#b9f2ff' },
  { index: 5, label: '100 баллов', type: 'points', value: 100, weight: 7,  color: '#e67e22' },
  { index: 6, label: '500 баллов', type: 'points', value: 500, weight: 3,  color: '#ffe066' }
];

function pickWheelPrize(){
  const total = WHEEL_PRIZES.reduce((a,p)=>a+p.weight,0);
  let r = Math.random()*total;
  for(const p of WHEEL_PRIZES){ if(r < p.weight) return p; r -= p.weight; }
  return WHEEL_PRIZES[0];
}

/* ---------- Джекпот ---------- */
const JACKPOT_MAX = 1000;
const JACKPOT_TICK_MS = 2300;
const JACKPOT_PER_TICK = 0.064;

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

/* ---------- КЕЙСЫ ---------- */
const CASES = {
  'Новичок':  { price: 39.99,  minRank: 0, prizes: [
    { v: 5,    w: 2500 }, { v: 10,   w: 3000 }, { v: 15,   w: 2000 },
    { v: 20,   w: 1000 }, { v: 30,   w: 800 },  { v: 50,   w: 400 },
    { v: 75,   w: 150 },  { v: 100,  w: 100 },  { v: 175,  w: 30 },
    { v: 500,  w: 15 },   { v: 750,  w: 4 },    { v: 1000, w: 1 }
  ]},
  'Бронза':   { price: 99,   minRank: 1, prizes: [
    { v: 10,   w: 2500 }, { v: 20,   w: 3000 }, { v: 30,   w: 2000 },
    { v: 50,   w: 1000 }, { v: 75,   w: 800 },  { v: 100,  w: 400 },
    { v: 150,  w: 150 },  { v: 200,  w: 100 },  { v: 300,  w: 30 },
    { v: 500,  w: 15 },   { v: 1000, w: 4 },    { v: 2000, w: 1 }
  ]},
  'Сильвер':  { price: 199,  minRank: 2, prizes: [
    { v: 25,   w: 2500 }, { v: 40,   w: 3000 }, { v: 60,   w: 2000 },
    { v: 100,  w: 1000 }, { v: 150,  w: 800 },  { v: 200,  w: 400 },
    { v: 300,  w: 150 },  { v: 500,  w: 100 },  { v: 750,  w: 30 },
    { v: 1000, w: 15 },   { v: 1500, w: 4 },    { v: 3000, w: 1 }
  ]},
  'Голд':     { price: 399,  minRank: 3, prizes: [
    { v: 50,   w: 2500 }, { v: 80,   w: 3000 }, { v: 120,  w: 2000 },
    { v: 200,  w: 1000 }, { v: 300,  w: 800 },  { v: 400,  w: 400 },
    { v: 600,  w: 150 },  { v: 1000, w: 100 },  { v: 1500, w: 30 },
    { v: 2000, w: 15 },   { v: 3000, w: 4 },    { v: 7500, w: 1 }
  ]},
  'Платина':  { price: 899,  minRank: 4, prizes: [
    { v: 100,  w: 2500 }, { v: 200,  w: 3000 }, { v: 300,  w: 2000 },
    { v: 500,  w: 1000 }, { v: 750,  w: 800 },  { v: 1000, w: 400 },
    { v: 1500, w: 150 },  { v: 2000, w: 100 },  { v: 3000, w: 30 },
    { v: 5000, w: 15 },   { v: 7500, w: 4 },    { v: 15000, w: 1 }
  ]},
  'Алмаз':    { price: 1999, minRank: 5, prizes: [
    { v: 250,  w: 2500 }, { v: 500,  w: 3000 }, { v: 750,  w: 2000 },
    { v: 1000, w: 1000 }, { v: 1500, w: 800 },  { v: 2000, w: 400 },
    { v: 3000, w: 150 },  { v: 5000, w: 100 },  { v: 7500, w: 30 },
    { v: 10000, w: 15 },  { v: 15000, w: 4 },   { v: 30000, w: 1 }
  ]},
  'Королевский': { price: 4999, minRank: 6, prizes: [
    { v: 500,  w: 2500 }, { v: 1000, w: 3000 }, { v: 1500, w: 2000 },
    { v: 2500, w: 1000 }, { v: 4000, w: 800 },  { v: 5000, w: 400 },
    { v: 7500, w: 150 },  { v: 10000, w: 100 }, { v: 15000, w: 30 },
    { v: 25000, w: 15 },  { v: 50000, w: 4 },   { v: 100000, w: 1 }
  ]}
};

function pickPrize(prizes) {
  const total = prizes.reduce((a,p) => a + p.w, 0);
  let r = Math.random() * total;
  for (const p of prizes) {
    if (r < p.w) return p.v;
    r -= p.w;
  }
  return prizes[prizes.length - 1].v;
}

/* ---------- ЗАДАНИЯ ДИЛЕРА ---------- */
const DEALER_TASKS = [
  { id: 'hands_10',  title: 'Сыграй 10 раздач за день',  goal: 10,  reward: 15,  type: 'any' },
  { id: 'hands_30',  title: 'Сыграй 30 раздач за день',  goal: 30,  reward: 30,  type: 'any' },
  { id: 'hands_50',  title: 'Сыграй 50 раздач за день',  goal: 50,  reward: 50,  type: 'any' },
  { id: 'hands_100', title: 'Сыграй 100 раздач за день', goal: 100, reward: 100, type: 'any' }
];

function todayStr(){ return new Date().toISOString().slice(0, 10); }

async function getDealerHandsToday(dealerName){
  try {
    const sRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM sessions WHERE LOWER(dealer) = LOWER($1) AND date = $2`,
      [dealerName, todayStr()]
    );
    const bRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM baccarat WHERE LOWER(dealer) = LOWER($1) AND date = $2`,
      [dealerName, todayStr()]
    );
    return (sRes.rows[0]?.c || 0) + (bRes.rows[0]?.c || 0);
  } catch (e) { return 0; }
}

async function getDealerBalance(dealerId){
  try {
    const r = await pool.query(`SELECT balance FROM dealer_balance WHERE dealer_id=$1`, [dealerId]);
    if (r.rows.length === 0) return 0;
    return parseFloat(r.rows[0].balance) || 0;
  } catch (e) { return 0; }
}

async function addDealerBalance(dealerId, amount){
  try {
    await pool.query(`
      INSERT INTO dealer_balance (dealer_id, balance) VALUES ($1, $2)
      ON CONFLICT (dealer_id) DO UPDATE SET balance = dealer_balance.balance + $2
    `, [dealerId, parseFloat(amount) || 0]);
    return true;
  } catch (e) { return false; }
}

/* ---------- CRASH ---------- */
const CRASH_WAIT_AFTER_FIRST_BET = 6000;
const CRASH_CRASH_PAUSE = 1500;
const BOT_COUNT = 6;

let crashState = { roundId: null, crashPoint: 1, startTime: 0, status: 'idle', waitTimer: null, hasRealBet: false };
let crashTimeouts = [];

function crashClearTimers() {
  crashTimeouts.forEach(t => clearTimeout(t));
  crashTimeouts = [];
  if (crashState.waitTimer) { clearTimeout(crashState.waitTimer); crashState.waitTimer = null; }
}

function crashGeneratePoint() {
  const r = Math.random();
  if (r < 0.10) return Math.max(1.00, 1 + Math.random() * 0.10);
  if (r < 0.60) return 1.10 + Math.random() * 0.90;
  if (r < 0.90) return 2.00 + Math.random() * 8.00;
  return 10.00 + Math.random() * 90.00;
}

let bots = [];
function botInit() {
  const ranks = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'VIP'];
  function generateCardId() {
    let s = '';
    for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
    if (s[0] === '0') s = '1' + s.slice(1);
    return s;
  }
  bots = [];
  const usedIds = new Set();
  for (let i = 0; i < BOT_COUNT; i++) {
    let id;
    do { id = generateCardId(); } while (usedIds.has(id));
    usedIds.add(id);
    const rank = ranks[Math.floor(Math.random() * ranks.length)];
    bots.push({ id, rank, masked: id.slice(0, 4) + '••••' });
  }
  console.log('Боты созданы: ' + bots.length);
}

async function botPlaceBet(bot) {
  const amount = [10, 20, 25, 50, 100][Math.floor(Math.random() * 5)];
  try {
    const r = await pool.query(
      `INSERT INTO crash_bets (round_id, player_id, player_name, player_rank, amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [crashState.roundId, 'BOT' + bot.id, bot.masked, bot.rank, amount]
    );
    return r.rows[0];
  } catch(e) { return null; }
}

function scheduleBotCashout(betId, targetMult) {
  const ms = Math.log(targetMult) / Math.log(1.00006);
  if (!isFinite(ms) || ms <= 0) return;
  crashTimeouts.push(setTimeout(async () => {
    if (crashState.status !== 'flying') return;
    const elapsed = Date.now() - crashState.startTime;
    let mult = Math.pow(1.00006, elapsed);
    if (mult >= crashState.crashPoint) return;
    try {
      await pool.query(
        `UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2 AND cashed_out=false`,
        [mult, betId]
      );
    } catch(e) {}
  }, ms));
}

async function crashStartWaiting() {
  try {
    crashClearTimers();
    const cp = crashGeneratePoint();
    try { await pool.query(`UPDATE crash_rounds SET status='crashed' WHERE status IN ('waiting', 'flying')`); } catch(e) {}
    const r = await pool.query(
      `INSERT INTO crash_rounds (crash_point, status) VALUES ($1, 'waiting') RETURNING id`,
      [cp]
    );
    crashState.roundId = r.rows[0].id;
    crashState.crashPoint = cp;
    crashState.startTime = 0;
    crashState.status = 'waiting';
    crashState.hasRealBet = false;
    crashState.waitTimer = null;
    console.log('CRASH round #' + crashState.roundId + ' waiting, point=' + cp.toFixed(2));
    scheduleBotsForRound();
  } catch (e) {
    console.error('ОШИБКА crashStartWaiting:', e.message);
    crashTimeouts.push(setTimeout(() => crashStartWaiting(), 3000));
  }
}

function scheduleBotsForRound() {
  const nBots = 1 + Math.floor(Math.random() * Math.min(BOT_COUNT, 4));
  const shuffled = [...bots].sort(() => Math.random() - 0.5).slice(0, nBots);
  shuffled.forEach((bot) => {
    const delay = 500 + Math.random() * 2500;
    crashTimeouts.push(setTimeout(async () => {
      if (crashState.status !== 'waiting') return;
      const bet = await botPlaceBet(bot);
      if (bet) {
        const target = 1.2 + Math.random() * 3.8;
        scheduleBotCashout(bet.id, target);
        tryStartFlightCountdown();
      }
    }, delay));
  });
}

function tryStartFlightCountdown() {
  if (crashState.status !== 'waiting') return;
  if (crashState.waitTimer) return;
  crashState.waitTimer = setTimeout(() => {
    if (crashState.status === 'waiting') crashStartFlight();
  }, CRASH_WAIT_AFTER_FIRST_BET);
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
    console.error('ОШИБКА crashStartFlight:', e.message);
    crashTimeouts.push(setTimeout(() => crashEndRound(), 1000));
  }
}

async function crashEndRound() {
  try {
    crashState.status = 'crashed';
    crashState.waitTimer = null;
    const endTime = Date.now();
    try { await pool.query(`UPDATE crash_rounds SET status='crashed', end_time=$1 WHERE id=$2`, [endTime, crashState.roundId]); } catch(e) {}
    try {
      const betsRes = await pool.query(
        `SELECT amount, cashout_mult, cashed_out FROM crash_bets 
         WHERE round_id = $1 AND (player_id IS NULL OR player_id NOT LIKE 'BOT%')`,
        [crashState.roundId]
      );
      let totalBet = 0, totalWin = 0;
      for (const bet of betsRes.rows) {
        const amt = parseFloat(bet.amount) || 0;
        totalBet += amt;
        if (bet.cashed_out) totalWin += amt * (parseFloat(bet.cashout_mult) || 0);
      }
      const net = totalBet - totalWin;
      if (totalBet > 0) {
        await pool.query(
          `INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`,
          [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Crash Round #${crashState.roundId}`]
        );
      }
    } catch(err) {}
    console.log('CRASH round #' + crashState.roundId + ' CRASHED at ' + crashState.crashPoint.toFixed(2));
    crashTimeouts.push(setTimeout(() => crashStartWaiting(), CRASH_CRASH_PAUSE));
  } catch (e) {
    console.error('ОШИБКА crashEndRound:', e.message);
    crashTimeouts.push(setTimeout(() => crashStartWaiting(), 3000));
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
        seen BOOLEAN DEFAULT FALSE,
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
        deposit_balance NUMERIC DEFAULT 0,
        wagering_required NUMERIC DEFAULT 0,
        wagering_done NUMERIC DEFAULT 0,
        last_rank TEXT DEFAULT 'Bronze',
        daily_level INT DEFAULT 0,
        daily_last_claim DATE,
        wheel_last_spin DATE,
        pending_bonus NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_rounds (
        id SERIAL PRIMARY KEY, crash_point NUMERIC NOT NULL, start_time BIGINT, end_time BIGINT,
        status TEXT DEFAULT 'waiting', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_bets (
        id SERIAL PRIMARY KEY, round_id INTEGER REFERENCES crash_rounds(id) ON DELETE CASCADE,
        player_id TEXT, player_name TEXT, player_rank TEXT DEFAULT 'Bronze',
        amount NUMERIC NOT NULL, cashout_mult NUMERIC, cashed_out BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cases_log (
        id SERIAL PRIMARY KEY, date TEXT, guest_id TEXT, guest_name TEXT,
        case_name TEXT, case_price NUMERIC DEFAULT 0, prize NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_balance (
        dealer_id INTEGER PRIMARY KEY, balance NUMERIC DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_daily (
        id SERIAL PRIMARY KEY, dealer_id INTEGER, date TEXT,
        hands INTEGER DEFAULT 0,
        UNIQUE(dealer_id, date)
      );
      CREATE TABLE IF NOT EXISTS dealer_tasks (
        id SERIAL PRIMARY KEY, dealer_id INTEGER, date TEXT, task_id TEXT,
        claimed BOOLEAN DEFAULT FALSE, reward NUMERIC DEFAULT 0,
        claimed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(dealer_id, date, task_id)
      );
      CREATE TABLE IF NOT EXISTS dealer_silence (
        id SERIAL PRIMARY KEY, dealer_id INTEGER UNIQUE, week_start BIGINT,
        incident BOOLEAN DEFAULT FALSE, updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_withdrawals (
        id SERIAL PRIMARY KEY, dealer_id INTEGER, sum NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const cols = [
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS pass TEXT DEFAULT '1234'`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS deposit_balance NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_required NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_done NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_rank TEXT DEFAULT 'Bronze'`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS daily_level INT DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS daily_last_claim DATE`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wheel_last_spin DATE`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS pending_bonus NUMERIC DEFAULT 0`,
      `ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS player_rank TEXT DEFAULT 'Bronze'`,
      `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT FALSE`
    ];
    for (const c of cols){ try { await pool.query(c); } catch(e){} }

    const own = await pool.query(`SELECT * FROM employees WHERE role = 'owner'`);
    if(own.rows.length === 0){
      await pool.query(`INSERT INTO employees (name, login, pass, role) VALUES ($1,$2,$3,$4)`,
        ['Владелец', 'Owner', '56UpahoS', 'owner']);
    }

    const dlCount = await pool.query(`SELECT COUNT(*) FROM dealers`);
    if(parseInt(dlCount.rows[0].count,10) === 0){
      await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1,$2,$3)`,
        ['Дилер', 'dealer', '56UpahoS']);
    }

    const jpCheck = await pool.query(`SELECT * FROM settings WHERE key IN ('jackpot', 'jackpot_last_tick')`);
    if(!jpCheck.rows.find(r => r.key === 'jackpot')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot', '0')`);
    }
    if(!jpCheck.rows.find(r => r.key === 'jackpot_last_tick')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot_last_tick', $1)`, [Date.now().toString()]);
    }

    console.log('База готова');
    botInit();
    try {
      const activeRes = await pool.query(`SELECT id FROM crash_rounds WHERE status IN ('waiting', 'flying')`);
      if (activeRes.rows.length > 0) {
        await pool.query(`UPDATE crash_rounds SET status='crashed' WHERE status IN ('waiting', 'flying')`);
      }
    } catch(e) {}
    crashStartWaiting();
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
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
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

async function accruePointsByNick(nick, rubAmount, source){
  if(!nick || !rubAmount || rubAmount <= 0) return null;
  const g = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nick.trim()]);
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
  let rankUp = false;
  let rankUpGift = 0;
  if (newIdx > prevIdx){
    rankUp = true;
    for (let i = prevIdx + 1; i <= newIdx; i++){ giftMoney += RANKS[RANK_ORDER[i]].gift; }
    rankUpGift = giftMoney;
    giftText = `Поздравляем с достижением ранга ${newRank}! Вам подарок ${giftMoney} бонусных рублей.`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }
  const addWagerReq = giftMoney * 5;
  const addWagerDone = addPoints;
  await pool.query(`
    UPDATE guests SET
      points = $1, rank = $2, last_rank = $3, bonus_text = $4, bonus_code = $5,
      bonus_balance = bonus_balance + $6,
      wagering_required = wagering_required + $7,
      wagering_done = wagering_done + $8
    WHERE id = $9
  `, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReq, addWagerDone, guest.id]);
  return { guestId: guest.id, addPoints, newPoints, newRank, giftMoney, source, rankUp, rankUpGift };
}

async function addBalanceByNick(nick, amount, isBonus = false){
  if(!nick || !amount) return false;
  const g = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [String(nick).trim()]);
  if(g.rows.length === 0) return false;
  if (isBonus) {
    await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`, [parseFloat(amount) || 0, g.rows[0].id]);
  } else {
    await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2`, [parseFloat(amount) || 0, g.rows[0].id]);
  }
  return true;
}

/* ---------- Хелперы гостя ---------- */
async function getGuestById(id){
  const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id)]);
  return r.rows[0] || null;
}

/* ============================================================
   СЕРВЕР
   ============================================================ */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    if(url === '/api/jackpot' && method === 'GET'){
      const jackpot = await getActualJackpot();
      return sendJSON(res, 200, { jackpot });
    }

    /* ================= ЗАДАНИЯ ДИЛЕРА ================= */
    if (url === '/api/dealer/silence' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealerId = parseInt(u.searchParams.get('id'), 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no dealer id' });
      const dRes = await pool.query('SELECT id, name FROM dealers WHERE id=$1', [dealerId]);
      if (dRes.rows.length === 0) return sendJSON(res, 404, { error: 'dealer not found' });
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const sRes = await pool.query('SELECT * FROM dealer_silence WHERE dealer_id=$1', [dealerId]);
      let row = sRes.rows[0];
      if (!row) {
        const r = await pool.query(`INSERT INTO dealer_silence (dealer_id, week_start, incident) VALUES ($1,$2,FALSE) RETURNING *`, [dealerId, now]);
        row = r.rows[0];
      }
      let weekStart = parseInt(row.week_start) || now;
      let incident = !!row.incident;
      if (now - weekStart >= weekMs) {
        const r = await pool.query(`UPDATE dealer_silence SET week_start=$1, incident=FALSE, updated_at=NOW() WHERE dealer_id=$2 RETURNING *`, [now, dealerId]);
        row = r.rows[0]; weekStart = now; incident = false;
      }
      const daysPassed = Math.min(7, Math.floor((now - weekStart) / (24 * 60 * 60 * 1000)));
      const daysLeft = Math.max(0, 7 - daysPassed);
      return sendJSON(res, 200, {
        dealer_id: dealerId, week_start: weekStart, days_passed: daysPassed,
        days_left: daysLeft, incident, percent: incident ? 7 : 15
      });
    }

    if (url === '/api/dealer/silence/incident' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no dealer id' });
      const sRes = await pool.query('SELECT * FROM dealer_silence WHERE dealer_id=$1', [dealerId]);
      if (sRes.rows.length === 0) {
        await pool.query(`INSERT INTO dealer_silence (dealer_id, week_start, incident) VALUES ($1,$2,TRUE)`, [dealerId, Date.now()]);
      } else {
        await pool.query(`UPDATE dealer_silence SET incident=TRUE, updated_at=NOW() WHERE dealer_id=$1`, [dealerId]);
      }
      return sendJSON(res, 200, { ok: true });
    }

    if (url === '/api/dealer/tasks' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealerId = parseInt(u.searchParams.get('id'), 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no dealer id' });
      const dRes = await pool.query('SELECT id, name FROM dealers WHERE id=$1', [dealerId]);
      if (dRes.rows.length === 0) return sendJSON(res, 404, { error: 'dealer not found' });
      const dealer = dRes.rows[0];
      const day = todayStr();
      const hands = await getDealerHandsToday(dealer.name);
      await pool.query(`INSERT INTO dealer_daily (dealer_id, date, hands) VALUES ($1,$2,$3)
        ON CONFLICT (dealer_id, date) DO UPDATE SET hands = $3`, [dealerId, day, hands]);
      const claimedRes = await pool.query(`SELECT task_id FROM dealer_tasks WHERE dealer_id=$1 AND date=$2 AND claimed=TRUE`, [dealerId, day]);
      const claimedSet = new Set(claimedRes.rows.map(r => r.task_id));
      const tasks = DEALER_TASKS.map(t => {
        const done = hands >= t.goal;
        const claimed = claimedSet.has(t.id);
        return { id: t.id, title: t.title, goal: t.goal, reward: t.reward,
          progress: Math.min(hands, t.goal), done, claimed, canClaim: done && !claimed, type: t.type };
      });
      return sendJSON(res, 200, { day, hands, tasks });
    }

    if (url === '/api/dealer/tasks/claim' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      const taskId = String(b.task_id || '');
      if (!dealerId || !taskId) return sendJSON(res, 400, { error: 'no data' });
      const task = DEALER_TASKS.find(t => t.id === taskId);
      if (!task) return sendJSON(res, 404, { error: 'task not found' });
      const dRes = await pool.query('SELECT id, name FROM dealers WHERE id=$1', [dealerId]);
      if (dRes.rows.length === 0) return sendJSON(res, 404, { error: 'dealer not found' });
      const dealer = dRes.rows[0];
      const day = todayStr();
      const hands = await getDealerHandsToday(dealer.name);
      if (hands < task.goal) return sendJSON(res, 400, { error: 'Условие ещё не выполнено' });
      const already = await pool.query(`SELECT id FROM dealer_tasks WHERE dealer_id=$1 AND date=$2 AND task_id=$3 AND claimed=TRUE`, [dealerId, day, taskId]);
      if (already.rows.length > 0) return sendJSON(res, 400, { error: 'Награда уже получена' });
      await pool.query(`INSERT INTO dealer_tasks (dealer_id, date, task_id, claimed, reward)
        VALUES ($1,$2,$3,TRUE,$4)
        ON CONFLICT (dealer_id, date, task_id) DO UPDATE SET claimed=TRUE, reward=$4, claimed_at=NOW()`,
        [dealerId, day, taskId, task.reward]);
      await addDealerBalance(dealerId, task.reward);
      const newBalance = await getDealerBalance(dealerId);
      return sendJSON(res, 200, { ok: true, reward: task.reward, balance: newBalance });
    }

    if (url === '/api/dealer/balance' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealerId = parseInt(u.searchParams.get('id'), 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no dealer id' });
      const dRes = await pool.query('SELECT id, name FROM dealers WHERE id=$1', [dealerId]);
      if (dRes.rows.length === 0) return sendJSON(res, 404, { error: 'dealer not found' });
      const balance = await getDealerBalance(dealerId);
      let withdrawals = [];
      try {
        const wRes = await pool.query(`SELECT id, sum, status, created_at::date::text AS date FROM dealer_withdrawals WHERE dealer_id=$1 ORDER BY id DESC LIMIT 50`, [dealerId]);
        withdrawals = wRes.rows;
      } catch(e) {}
      return sendJSON(res, 200, { dealer: { id: dealerId, name: dRes.rows[0].name, balance }, withdrawals });
    }

    if (url === '/api/dealer/withdraw' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.id, 10);
      const sum = parseFloat(b.sum) || 0;
      if (!dealerId) return sendJSON(res, 400, { error: 'no dealer id' });
      if (sum <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть больше 0' });
      const balance = await getDealerBalance(dealerId);
      if (sum > balance) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      await addDealerBalance(dealerId, -sum);
      await pool.query(`INSERT INTO dealer_withdrawals (dealer_id, sum, status) VALUES ($1,$2,'pending')`, [dealerId, sum]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ================= КЕЙСЫ ================= */
    if (url === '/api/cases/last-drops' && method === 'GET') {
      try {
        const r = await pool.query(`SELECT guest_name, case_name, prize, created_at FROM cases_log WHERE prize > 0 ORDER BY id DESC LIMIT 20`);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 200, []); }
    }

    if (url === '/api/cases/list' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guestId = u.searchParams.get('guest_id');
      let rankIdx = 0;
      if (guestId) {
        const g = await pool.query('SELECT rank FROM guests WHERE id=$1', [guestId]);
        if (g.rows.length) rankIdx = RANK_INDEX[g.rows[0].rank] || 0;
      }
      const list = Object.entries(CASES).map(([name, c]) => ({
        name, price: c.price, minRank: c.minRank,
        available: rankIdx >= c.minRank,
        prizes: c.prizes.map(p => p.v)
      }));
      return sendJSON(res, 200, list);
    }

    if (url === '/api/cases/open' && method === 'POST') {
      const b = await parseBody(req);
      const { guest_id, case_name } = b;
      if (!guest_id || !case_name) return sendJSON(res, 400, { error: 'no data' });
      const c = CASES[case_name];
      if (!c) return sendJSON(res, 400, { error: 'Кейс не найден' });
      const g = await pool.query('SELECT * FROM guests WHERE id=$1', [guest_id]);
      if (!g.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const guest = g.rows[0];
      const rankIdx = RANK_INDEX[guest.rank] || 0;
      if (rankIdx < c.minRank) return sendJSON(res, 403, { error: 'Кейс недоступен для вашего ранга' });
      const bal = (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0);
      if (bal < c.price) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      let bonus = parseFloat(guest.bonus_balance) || 0;
      let dep = parseFloat(guest.deposit_balance) || 0;
      let remaining = c.price;
      if (bonus >= remaining) { bonus -= remaining; remaining = 0; }
      else { remaining -= bonus; bonus = 0; dep -= remaining; }
      const prize = pickPrize(c.prizes);
      const newBalance = bonus + dep + prize;
      await pool.query('UPDATE guests SET bonus_balance=$1, deposit_balance=$2 WHERE id=$3', [bonus, dep + prize, guest.id]);
      await pool.query(`INSERT INTO cases_log (date, guest_id, guest_name, case_name, case_price, prize) VALUES ($1,$2,$3,$4,$5,$6)`,
        [todayStr(), guest.id, guest.name, case_name, c.price, prize]);
      const net = c.price - prize;
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
        [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Case ${case_name} (${guest.name})`]);
      return sendJSON(res, 200, { ok: true, prize, new_balance: newBalance, case_name, price: c.price });
    }

    /* ================= CRASH ================= */
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
            `SELECT id, player_id, player_name, player_rank, amount, cashout_mult, cashed_out
             FROM crash_bets WHERE round_id=$1 ORDER BY id ASC`, [crashState.roundId]);
          bets = betsRes.rows;
        } catch(e) {}
      }
      let history = [];
      try {
        const histRes = await pool.query(`SELECT crash_point FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT 15`);
        history = histRes.rows.map(r => parseFloat(r.crash_point));
      } catch(e) {}
      return sendJSON(res, 200, {
        roundId: crashState.roundId, status: crashState.status, startTime: crashState.startTime,
        crashPoint: crashState.status === 'crashed' ? crashState.crashPoint : null,
        multiplier, bets, history, hasRealBet: crashState.hasRealBet
      });
    }

    if (url === '/api/crash/all-bets' && method === 'GET') {
      try {
        const r = await pool.query(`SELECT b.*, r.crash_point, r.start_time FROM crash_bets b JOIN crash_rounds r ON b.round_id = r.id ORDER BY b.id DESC LIMIT 200`);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 200, []); }
    }

    if (url === '/api/crash/clear' && method === 'DELETE') {
      try {
        await pool.query('DELETE FROM crash_bets');
        await pool.query('DELETE FROM crash_rounds');
        await pool.query("DELETE FROM online WHERE note LIKE 'Crash Round%'");
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/crash/bet' && method === 'POST') {
      const b = await parseBody(req);
      if (crashState.status !== 'waiting') return sendJSON(res, 400, { error: 'Раунд уже начался' });
      const amt = parseFloat(b.amount) || 0;
      if (amt < 10) return sendJSON(res, 400, { error: 'Мин. ставка 10 ₽' });
      if (amt > 100) return sendJSON(res, 400, { error: 'Макс. ставка 100 ₽' });
      let maskName = '••••', playerRank = 'Bronze';
      if (b.player_id) {
        const gRes = await pool.query(`SELECT * FROM guests WHERE id=$1`, [String(b.player_id)]);
        if (gRes.rows.length > 0) {
          const guest = gRes.rows[0];
          const totalBal = (parseFloat(guest.bonus_balance) || 0) + (parseFloat(guest.deposit_balance) || 0);
          if (totalBal < amt) return sendJSON(res, 400, { error: 'Недостаточно средств' });
          let bonus = parseFloat(guest.bonus_balance) || 0;
          let dep = parseFloat(guest.deposit_balance) || 0;
          let remaining = amt;
          if (bonus >= remaining) { bonus -= remaining; remaining = 0; }
          else { remaining -= bonus; bonus = 0; dep -= remaining; }
          await pool.query(`UPDATE guests SET bonus_balance = $1, deposit_balance = $2 WHERE id=$3`, [bonus, dep, String(b.player_id)]);
          const s = String(guest.id);
          maskName = s.length <= 4 ? s : s.slice(0, 4) + '••••';
          playerRank = guest.rank || 'Bronze';
        }
      }
      const r = await pool.query(
        `INSERT INTO crash_bets (round_id, player_id, player_name, player_rank, amount)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [crashState.roundId, b.player_id || null, maskName, playerRank, amt]);
      if (b.player_id) crashState.hasRealBet = true;
      tryStartFlightCountdown();
      return sendJSON(res, 200, { ok: true, bet: r.rows[0] });
    }

    if (url === '/api/crash/cashout' && method === 'POST') {
      const b = await parseBody(req);
      if (crashState.status !== 'flying') return sendJSON(res, 400, { error: 'Не в фазе полёта' });
      const elapsed = Date.now() - crashState.startTime;
      let mult = Math.pow(1.00006, elapsed);
      if (mult >= crashState.crashPoint) return sendJSON(res, 400, { error: 'Поздно — уже краш' });
      const betRes = await pool.query(`SELECT * FROM crash_bets WHERE id=$1 AND round_id=$2 AND cashed_out=false`, [b.bet_id, crashState.roundId]);
      if (!betRes.rows.length) return sendJSON(res, 400, { error: 'Ставка не найдена' });
      const bet = betRes.rows[0];
      const winAmount = (parseFloat(bet.amount) * mult);
      await pool.query(`UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2`, [mult, b.bet_id]);
      if (bet.player_id && !String(bet.player_id).startsWith('BOT')) {
        await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2`, [winAmount, bet.player_id]);
      }
      return sendJSON(res, 200, { ok: true, mult, win: winAmount });
    }

    /* ================= ГОСТИ ================= */
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
        [cardId, g.name, g.rank || 'Bronze', g.points || 0, g.visits || 0, g.bonus_text || '', g.bonus_code || '', g.pass || '1234']);
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
          UPDATE guests SET name = $1, rank = $2, pass = $3, bonus_text = $4,
            bonus_code = $5, bonus_balance = $6 WHERE id = $7
        `, [g.name, g.rank, g.pass, g.bonus_text, g.bonus_code, g.bonus_balance || 0, g.id]);
        return sendJSON(res, 200, { ok: true });
      } catch(e){ return sendJSON(res, 500, { error: e.message }); }
    }
    if(url === '/api/guests/withdraw-deduct' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      await pool.query('UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2', [parseFloat(sum) || 0, id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ================= ЛОГИН ГОСТЯ ================= */
    if(url === '/api/guest/login' && method === 'POST'){
      const { id, pass } = await parseBody(req);
      if(!id || !pass) return sendJSON(res, 400, { error: 'Введите номер карты и пароль' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id).trim()]);
      if(r.rows.length === 0) return sendJSON(res, 401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      const realPass = g.pass || '1234';
      if(String(pass) !== String(realPass)) return sendJSON(res, 401, { error: 'Неверный пароль' });
      await pool.query('UPDATE guests SET visits = visits + 1, last_visit = NOW() WHERE id=$1', [g.id]);
      return sendJSON(res, 200, { ok: true, guest: g });
    }

    if(url === '/api/guest/me' && method === 'GET'){
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const guest = r.rows[0];
      let unseen = [];
      try {
        const dRes = await pool.query(
          `SELECT id, sum, date FROM deposits WHERE LOWER(nick) = LOWER($1) AND status = 'approved' AND seen = FALSE ORDER BY id DESC`,
          [guest.name]);
        unseen = dRes.rows;
      } catch(e) {}
      return sendJSON(res, 200, { guest, unseen_deposits: unseen });
    }

    /* ================= DAILY ================= */
    if (url === '/api/guest/daily' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });

      const today = todayStr();
      const last = g.daily_last_claim ? String(g.daily_last_claim).slice(0,10) : null;
      let level = parseInt(g.daily_level) || 0;

      if(last && last !== today){
        const diff = (new Date(today) - new Date(last)) / 86400000;
        if(diff > 1){
          level = 0;
          await pool.query(`UPDATE guests SET daily_level=0, pending_bonus=0 WHERE id=$1`, [id]);
        }
      }

      const claimed_today = last === today;
      const nextReward = claimed_today ? 0 : DAILY_REWARDS[Math.min(level, 6)];

      return sendJSON(res, 200, {
        level,
        claimed_today,
        rewards: DAILY_REWARDS,
        next_reward: nextReward,
        pending_bonus: parseFloat(g.pending_bonus)||0
      });
    }

    if (url === '/api/guest/daily-claim' && method === 'POST') {
      const b = await parseBody(req);
      const id = b.id;
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });

      const today = todayStr();
      const last = g.daily_last_claim ? String(g.daily_last_claim).slice(0,10) : null;
      if(last === today) return sendJSON(res, 400, { error: 'Сегодня уже забрали' });

      let level = parseInt(g.daily_level) || 0;
      let pending = parseFloat(g.pending_bonus) || 0;

      if(last){
        const diff = (new Date(today) - new Date(last)) / 86400000;
        if(diff > 1){ level = 0; pending = 0; }
      }

      if(level >= 7) level = 0;

      const reward = DAILY_REWARDS[level] || 0;
      const newLevel = level + 1;

      await pool.query(`
        UPDATE guests SET daily_level=$1, daily_last_claim=$2, pending_bonus=$3, last_visit=NOW()
        WHERE id=$4
      `, [newLevel, today, pending + reward, id]);

      return sendJSON(res, 200, { reward, level: newLevel, pending_bonus: pending + reward });
    }

    /* ================= WHEEL ================= */
    if (url === '/api/guest/wheel-state' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });
      const today = todayStr();
      const last = g.wheel_last_spin ? String(g.wheel_last_spin).slice(0,10) : null;
      return sendJSON(res, 200, {
        can_spin: last !== today,
        prizes: WHEEL_PRIZES
      });
    }

    if (url === '/api/guest/wheel-spin' && method === 'POST') {
      const b = await parseBody(req);
      const id = b.id;
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });
      const today = todayStr();
      const last = g.wheel_last_spin ? String(g.wheel_last_spin).slice(0,10) : null;
      if(last === today) return sendJSON(res, 400, { error: 'Сегодня уже крутили' });

      const prize = pickWheelPrize();
      if(prize.type === 'points'){
        await pool.query(`UPDATE guests SET points = points + $1, wheel_last_spin=$2, last_visit=NOW() WHERE id=$3`,
          [prize.value, today, id]);
      } else {
        await pool.query(`UPDATE guests SET pending_bonus = pending_bonus + $1, wheel_last_spin=$2, last_visit=NOW() WHERE id=$3`,
          [prize.value, today, id]);
      }
      return sendJSON(res, 200, { prize });
    }

    /* ================= СВОДКА ПРОФИЛЯ ================= */
    if (url === '/api/guest/summary' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });

      const points = parseInt(g.points) || 0;
      const curIdx = RANK_ORDER.indexOf(g.rank);
      const nextRank = RANK_ORDER[curIdx+1] || null;
      const nextMin = nextRank ? RANKS[nextRank].min : null;

      return sendJSON(res, 200, {
        id: g.id, name: g.name, rank: g.rank,
        points,
        bonus_balance: parseFloat(g.bonus_balance)||0,
        deposit_balance: parseFloat(g.deposit_balance)||0,
        pending_bonus: parseFloat(g.pending_bonus)||0,
        wagering_required: parseFloat(g.wagering_required)||0,
        wagering_done: parseFloat(g.wagering_done)||0,
        next_rank: nextRank, next_min: nextMin,
        bonus_text: g.bonus_text || '', bonus_code: g.bonus_code || '',
        min_rank_silver: RANKS.Silver.min
      });
    }

    /* ================= ВЫВОД: на онлайн-баланс ================= */
    if (url === '/api/guest/withdraw-to-casino' && method === 'POST') {
      const b = await parseBody(req);
      const id = b.id;
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });

      const pending = parseFloat(g.pending_bonus) || 0;
      if(pending <= 0) return sendJSON(res, 400, { error: 'Нет бонусов для перевода' });

      const req_ = parseFloat(g.wagering_required) || 0;
      const done = parseFloat(g.wagering_done) || 0;
      if(req_ > 0 && done < req_){
        return sendJSON(res, 400, { error: `Отыграйте ещё ${Math.ceil(req_ - done)} баллов` });
      }

      // переводим pending_bonus → deposit_balance (доступно для игры и вывода на онлайн)
      await pool.query(`
        UPDATE guests SET deposit_balance = deposit_balance + pending_bonus, pending_bonus = 0
        WHERE id=$1
      `, [id]);

      return sendJSON(res, 200, { ok: true, amount: pending });
    }

    /* ================= ВЫВОД: реальные деньги ================= */
    if (url === '/api/guest/withdraw-real' && method === 'POST') {
      const b = await parseBody(req);
      const id = b.id;
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if(!g) return sendJSON(res, 404, { error: 'not found' });

      const rankIdx = RANK_INDEX[g.rank] || 1;
      if(rankIdx < 2) return sendJSON(res, 400, { error: 'Нужен ранг Silver или выше' });

      const req_ = parseFloat(g.wagering_required) || 0;
      const done = parseFloat(g.wagering_done) || 0;
      if(req_ > 0 && done < req_){
        return sendJSON(res, 400, { error: `Отыграйте ещё ${Math.ceil(req_ - done)} баллов` });
      }

      const amount = parseFloat(g.deposit_balance) || 0;
      if(amount <= 0) return sendJSON(res, 400, { error: 'Нечего выводить' });

      await pool.query(`UPDATE guests SET deposit_balance = 0 WHERE id=$1`, [id]);
      const w = await pool.query(
        `INSERT INTO withdrawals (date,nick,email,sum,fee,net,status) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
        [todayStr(), g.name, '', amount, 0, amount]);
      return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] });
    }

    /* ================= ВЫВОД: старая версия (совместимость) ================= */
    if(url === '/api/guest/withdraw' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const amt = parseFloat(sum) || 0;
      if(amt <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть больше 0' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'Карта не найдена' });
      const g = r.rows[0];
      const balance = (parseFloat(g.bonus_balance) || 0) + (parseFloat(g.deposit_balance) || 0);
      const required = parseFloat(g.wagering_required) || 0;
      const done = parseFloat(g.wagering_done) || 0;
      if (done < required) return sendJSON(res, 400, { error: 'Сначала выполните условие (отыгрыш)' });
      if (amt > balance) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      let bonus = parseFloat(g.bonus_balance) || 0;
      let dep = parseFloat(g.deposit_balance) || 0;
      let remaining = amt;
      if (bonus >= remaining) { bonus -= remaining; remaining = 0; }
      else { remaining -= bonus; bonus = 0; dep -= remaining; }
      await pool.query('UPDATE guests SET bonus_balance = $1, deposit_balance = $2 WHERE id=$3', [bonus, dep, id]);
      const w = await pool.query(
        `INSERT INTO withdrawals (date, nick, email, sum, fee, net, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [todayStr(), g.name, '', amt, 0, amt, 'pending']);
      return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] });
    }

    /* ================= СЕССИИ ================= */
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

    if (url === '/api/sessions/round' && method === 'POST') {
      const b = await parseBody(req);
      const dealer = b.dealer || '';
      const gameType = b.game_type || 'bj';
      const nick = String(b.nick || '').trim();
      const bet = parseFloat(b.bet) || 0;
      const win = parseFloat(b.win) || 0;
      const jackpotHit = b.jackpot === true;
      if (!nick) return sendJSON(res, 400, { error: 'Введите ник игрока' });
      if (bet < 10 || bet > 10000) return sendJSON(res, 400, { error: 'Ставка от 10 до 10 000 ₽' });
      if (win < 0 || win > 100000) return sendJSON(res, 400, { error: 'Выигрыш от 0 до 100 000 ₽' });
      const today = new Date().toISOString().slice(0, 10);
      let sessionRow = null;
      if (gameType === 'bj') {
        const dep = bet;
        const outSum = win;
        const net = dep - outSum;
        const r = await pool.query(
          `INSERT INTO sessions (date,nick,decks,dep,out_sum,fee,net,result,dealer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [today, nick, 1, dep, outSum, 0, net, net, dealer]);
        sessionRow = r.rows[0];
        await accruePointsByNick(nick, dep, 'blackjack');
      } else {
        const r = await pool.query(
          `INSERT INTO baccarat (date,player,bet,sum,result,dealer)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [today, nick, 'player', bet, win > 0 ? 'win' : 'lose', dealer]);
        sessionRow = r.rows[0];
        await accruePointsByNick(nick, bet, 'baccarat');
      }
      try {
        const hands = await getDealerHandsToday(dealer);
        const dId = await pool.query(`SELECT id FROM dealers WHERE name=$1 LIMIT 1`, [dealer]);
        if (dId.rows.length > 0) {
          await pool.query(`INSERT INTO dealer_daily (dealer_id, date, hands) VALUES ($1,$2,$3)
            ON CONFLICT (dealer_id, date) DO UPDATE SET hands = $3`, [dId.rows[0].id, today, hands]);
        }
      } catch(e) {}
      let currentJP = await getActualJackpot();
      if (jackpotHit) { currentJP = 0; }
      else {
        currentJP += Math.max(1, bet * 0.15);
        if (currentJP >= JACKPOT_MAX) currentJP = 0;
      }
      await pool.query(`UPDATE settings SET value=$1 WHERE key='jackpot'`, [currentJP.toString()]);
      await pool.query(`UPDATE settings SET value=$1 WHERE key='jackpot_last_tick'`, [Date.now().toString()]);
      try {
        const net = bet - win;
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
          [today, net >= 0 ? 'доход' : 'расход', Math.abs(net), `${gameType === 'bj' ? 'Blackjack' : 'Baccarat'} (${nick})`]);
      } catch(e) {}
      return sendJSON(res, 200, { ok: true, session: sessionRow, jackpot: currentJP, jackpot_reset: jackpotHit });
    }

    /* ================= БАККАРА ================= */
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

    /* ================= ДЕПОЗИТЫ ================= */
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
    if (url.startsWith('/api/deposits/') && url.endsWith('/seen') && method === 'POST') {
      const id = url.split('/')[3];
      await pool.query(`UPDATE deposits SET seen = TRUE WHERE id=$1`, [id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/deposits/') && method === 'PUT'){
      const id = url.split('/')[3];
      const d = await parseBody(req);
      const beforeRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if(beforeRes.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const dep = beforeRes.rows[0];
      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);
      if(d.status === 'approved' && dep.status !== 'approved'){
        await addBalanceByNick(dep.nick, dep.sum, false);
        await pool.query(`UPDATE deposits SET seen = FALSE WHERE id=$1`, [id]);
      }
      if(d.status === 'rejected' && dep.status === 'approved'){
        const g = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [dep.nick]);
        if(g.rows.length > 0){
          await pool.query('UPDATE guests SET deposit_balance = GREATEST(0, deposit_balance - $1) WHERE id=$2',
            [parseFloat(dep.sum) || 0, g.rows[0].id]);
        }
      }
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/deposits/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM deposits WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ================= ВЫВОДЫ ================= */
    if(url === '/api/withdrawals' && method === 'GET'){
      const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/withdrawals' && method === 'POST'){
      const w = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO withdrawals (date,nick,email,sum,fee,net,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
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

    /* ================= ВЫПЛАТЫ ================= */
    if(url === '/api/payouts' && method === 'GET'){
      const r = await pool.query('SELECT * FROM payouts ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/payouts' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(`INSERT INTO payouts (date,dealer,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`,
        [p.date,p.dealer,p.sum,p.note]);
      return sendJSON(res, 200, { ok: true, payout: r.rows[0] });
    }
    if(url.startsWith('/api/payouts/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM payouts WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ================= ИГРОКИ ================= */
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

    /* ================= ИГРЫ ================= */
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

    /* ================= АУДИТ ================= */
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

    /* ================= СОТРУДНИКИ ================= */
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

    /* ================= ДИЛЕРЫ ================= */
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

    /* ================= ОНЛАЙН ================= */
    if(url === '/api/online' && method === 'GET'){
      const r = await pool.query('SELECT * FROM online ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/online' && method === 'POST'){
      const o = await parseBody(req);
      const r = await pool.query(`INSERT INTO online (date,type,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`,
        [o.date,o.type,o.sum,o.note]);
      return sendJSON(res, 200, { ok: true, online: r.rows[0] });
    }
    if(url.startsWith('/api/online/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM online WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ================= ЛОГИН ================= */
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

    /* ================= СТАТИКА ================= */
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
  console.log('  Кейсы:   /cases.html');
  console.log('  Гость:   /profile2.html');
  console.log('');
});
