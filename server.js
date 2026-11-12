const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { Server: SocketServer } = require('socket.io');
const { AccessToken } = require('livekit-server-sdk');

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

pool.on('error', (err) => console.error('PG Pool error:', err.message));

const POINTS_PER_RUB = 0.2;
const RANKS = {
  Bronze:   { min: 0, gift: 0 }, Silver: { min: 100, gift: 0 },
  Gold:     { min: 300, gift: 0 }, Platinum: { min: 600, gift: 0 },
  Diamond:  { min: 1000, gift: 0 }, VIP: { min: 1500, gift: 0 }
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

const DEALER_POINTS_PER_RUB = 0.2;
const DEALER_RANKS = [
  { key: 'Trainee', label: 'Стажёр',    min: 0,    percent: 10, bonus: 0,   color: '#cd7f32' },
  { key: 'Dealer',  label: 'Дилер',     min: 200,  percent: 11, bonus: 0,   color: '#c0c0c0' },
  { key: 'Senior',  label: 'Ст. дилер', min: 600,  percent: 12, bonus: 100, color: '#f1c40f' },
  { key: 'Master',  label: 'Мастер',    min: 1200, percent: 13, bonus: 200, color: '#e5e4e2' },
  { key: 'Elite',   label: 'Элит',      min: 2000, percent: 14, bonus: 300, color: '#b9f2ff' },
  { key: 'VIP',     label: 'VIP',       min: 3000, percent: 15, bonus: 500, color: '#ffe066' }
];
function getDealerRank(points){
  let rank = DEALER_RANKS[0];
  for (const r of DEALER_RANKS) { if (points >= r.min) rank = r; else break; }
  return rank;
}

const DAILY_REWARDS = [10, 15, 20, 25, 30, 35, 40];
function todayStr(){ return new Date().toISOString().slice(0, 10); }
function dateStr(v){
  if(!v) return null;
  if(v instanceof Date){
    const y = v.getFullYear(); const m = String(v.getMonth()+1).padStart(2,'0'); const d = String(v.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0,10);
}

const JACKPOT_MAX = 1000, JACKPOT_TICK_MS = 2300, JACKPOT_PER_TICK = 0.064;
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
  } catch (e) { console.error('getActualJackpot error:', e.message); return 0; }
}

const CASES = {
  'Новичок': { price: 39.99, minRank: 0, prizes: [
    { v:10,   w:42000 }, { v:15,   w:24000 }, { v:25,   w:13000 },
    { v:50,   w:8500  }, { v:100,  w:5500  }, { v:115,  w:3200  },
    { v:200,  w:1800  }, { v:250,  w:900   }, { v:500,  w:500   },
    { v:650,  w:300   }, { v:1000, w:50    }
  ]},
  'Сильвер': { price: 199, minRank: 2, prizes: [
    { v:10,w:1500 },{ v:20,w:2000 },{ v:50,w:2500 },{ v:80,w:2000 },{ v:120,w:1000 },{ v:200,w:600 },
    { v:300,w:200 },{ v:500,w:100 },{ v:1000,w:50 },{ v:1500,w:30 },{ v:2000,w:15 }
  ]},
  'Голд': { price: 399, minRank: 3, prizes: [
    { v:20,w:1500 },{ v:50,w:2000 },{ v:100,w:2500 },{ v:150,w:2000 },{ v:250,w:1000 },{ v:400,w:600 },
    { v:600,w:200 },{ v:1000,w:100 },{ v:2000,w:50 },{ v:3000,w:15 }
  ]},
  'Платина': { price: 899, minRank: 4, prizes: [
    { v:50,w:1500 },{ v:100,w:2000 },{ v:200,w:2500 },{ v:350,w:2000 },{ v:500,w:1000 },{ v:900,w:600 },
    { v:1500,w:200 },{ v:2500,w:100 },{ v:4000,w:50 }
  ]},
  'Королевский': { price: 4999, minRank: 6, prizes: [
    { v:200,w:1500 },{ v:500,w:2000 },{ v:1000,w:2500 },{ v:2000,w:2000 },{ v:3500,w:1000 },{ v:5000,w:600 },
    { v:6000,w:200 }
  ]}
};
function pickPrize(prizes) {
  const total = prizes.reduce((a,p) => a + p.w, 0);
  let r = Math.random() * total;
  for (const p of prizes) { if (r < p.w) return p.v; r -= p.w; }
  return prizes[prizes.length - 1].v;
}

const LADDER_MULTS = {
  1: [1.05, 1.10, 1.16, 1.22, 1.29, 1.36, 1.44, 1.53, 1.63, 1.74, 1.86, 2.00, 2.15],
  2: [1.11, 1.25, 1.41, 1.59, 1.80, 2.04, 2.32, 2.65, 3.03, 3.49, 4.03, 4.68, 5.45],
  3: [1.18, 1.42, 1.70, 2.06, 2.50, 3.06, 3.75, 4.62, 5.72, 7.14, 8.97, 11.34, 14.45],
  4: [1.25, 1.61, 2.07, 2.70, 3.53, 4.66, 6.20, 8.33, 11.33, 15.61, 21.83, 30.98, 44.60],
  5: [1.33, 1.82, 2.51, 3.50, 4.94, 7.07, 10.27, 15.16, 22.80, 35.04, 55.02, 88.34, 145.60],
  6: [1.40, 2.05, 3.02, 4.51, 6.84, 10.57, 16.69, 27.04, 45.07, 77.79, 139.76, 263.78, 523.93],
  7: [1.47, 2.32, 3.69, 5.96, 9.85, 16.78, 29.62, 54.58, 105.62, 216.05, 471.43, 1102.24, 2783.50]
};

const PLINKO_ROWS = 8;
const PLINKO_MULTIPLIERS = {
  low:    [2.4, 1.5, 1.1, 0.9, 0.6, 0.9, 1.1, 1.5, 2.4],
  medium: [7.0, 2.2, 1.0, 0.5, 0.25, 0.5, 1.0, 2.2, 7.0],
  high:   [15.0, 3.5, 0.8, 0.25, 0.1, 0.25, 0.8, 3.5, 15.0]
};
const MAX_WIN_SLOT = 5000;

async function debitBet(guestId, amount) {
  const r = await pool.query('SELECT bonus_balance, deposit_balance FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return null;
  let bonus = parseFloat(r.rows[0].bonus_balance) || 0;
  let dep = parseFloat(r.rows[0].deposit_balance) || 0;
  const total = bonus + dep;
  if (total < amount) return null;

  let rem = amount;
  let fromBonus = 0;
  let fromDeposit = 0;

  if (bonus >= rem) { fromBonus = rem; bonus -= rem; rem = 0; }
  else { fromBonus = bonus; rem -= bonus; bonus = 0; fromDeposit = rem; dep -= rem; }

  await pool.query('UPDATE guests SET bonus_balance=$1, deposit_balance=$2 WHERE id=$3', [bonus, dep, guestId]);
  return { bonus, deposit: dep, fromBonus, fromDeposit };
}

async function creditWin(guestId, winAmount, betAmount) {
  if (winAmount <= 0) return;
  try {
    const g = await pool.query('SELECT wagering_required, wagering_done, bonus_balance FROM guests WHERE id=$1', [guestId]);
    if (!g.rows.length) return;
    const req_ = parseFloat(g.rows[0].wagering_required) || 0;
    const done = parseFloat(g.rows[0].wagering_done) || 0;
    if (req_ > 0 && done < req_) {
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1, wagering_done = wagering_done + $2 WHERE id=$3', [winAmount, betAmount || 0, guestId]);
      const check = await pool.query('SELECT wagering_required, wagering_done, bonus_balance FROM guests WHERE id=$1', [guestId]);
      if (check.rows.length) {
        const nr = parseFloat(check.rows[0].wagering_required) || 0;
        const nd = parseFloat(check.rows[0].wagering_done) || 0;
        const nb = parseFloat(check.rows[0].bonus_balance) || 0;
        if (nr > 0 && nd >= nr && nb > 0) {
          await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1, bonus_balance = 0, wagering_required = 0, wagering_done = 0 WHERE id=$2', [nb * 2, guestId]);
        }
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

async function getCasinoStats(period = 'all') {
  try {
    let where = `WHERE
      note NOT ILIKE '%бонус%'
      AND note NOT ILIKE '%bonus%'
      AND note NOT ILIKE '%ранг%'
      AND note NOT ILIKE '%rank%'
      AND note NOT ILIKE '%daily%'
      AND note NOT ILIKE '%подарок%'
      AND note NOT ILIKE '%gift%'
      AND note NOT ILIKE '%admin%'
      AND note NOT ILIKE '%refuse%'
      AND note NOT ILIKE '%cancel%'
      AND note NOT ILIKE '%withdraw request%'
      AND note NOT ILIKE '%withdraw reject%'`;
    const params = [];
    if (period === 'today') { where += ` AND date = $1`; params.push(todayStr()); }
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'доход' THEN sum ELSE 0 END), 0)::numeric AS income,
        COALESCE(SUM(CASE WHEN type = 'расход' THEN sum ELSE 0 END), 0)::numeric AS expense
      FROM online ${where}
    `, params);
    const income = parseFloat(r.rows[0].income) || 0;
    const expense = parseFloat(r.rows[0].expense) || 0;
    return { income, expense, profit: income - expense, turnover: income + expense };
  } catch (e) { return { income: 0, expense: 0, profit: 0, turnover: 0 }; }
}

let HOUSE_CACHE = { rtp: 0.80, ts: 0, treasury: 0, actualRTP: 0, mode: 'base' };
const HOUSE_CACHE_MS = 4000;
const HOUSE_RTP_CAP = 0.80;
const HOUSE_RTP_FLOOR = 0.60;
const HOUSE_TARGET = 0.80;

async function getTreasury() {
  try {
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'доход' THEN sum ELSE 0 END), 0)::numeric AS income,
        COALESCE(SUM(CASE WHEN type = 'расход' THEN sum ELSE 0 END), 0)::numeric AS expense
      FROM online
      WHERE note NOT ILIKE '%бонус%' AND note NOT ILIKE '%bonus%'
        AND note NOT ILIKE '%ранг%' AND note NOT ILIKE '%rank%'
        AND note NOT ILIKE '%daily%' AND note NOT ILIKE '%подарок%'
        AND note NOT ILIKE '%gift%' AND note NOT ILIKE '%admin%'
        AND note NOT ILIKE '%refuse%' AND note NOT ILIKE '%cancel%'
        AND note NOT ILIKE '%withdraw request%' AND note NOT ILIKE '%withdraw reject%'
    `);
    const income = parseFloat(r.rows[0].income) || 0;
    const expense = parseFloat(r.rows[0].expense) || 0;
    return { income, expense, treasury: income - expense, turnover: income + expense };
  } catch(e) {
    return { income: 0, expense: 0, treasury: 0, turnover: 0 };
  }
}

async function getHouseRTP() {
  const now = Date.now();
  if (now - HOUSE_CACHE.ts < HOUSE_CACHE_MS && HOUSE_CACHE.rtp) return HOUSE_CACHE;
  const t = await getTreasury();
  const today = await getCasinoStats('today');
  const turnover = today.turnover || 0;
  const paidOut = today.expense || 0;
  const actualRTP = turnover > 0 ? paidOut / turnover : HOUSE_TARGET;
  let rtp = HOUSE_TARGET;
  let mode = 'base';
  if (turnover >= 100) {
    const overpay = actualRTP - HOUSE_TARGET;
    if (overpay > 0) { rtp = HOUSE_TARGET - Math.min(0.20, overpay * 2.5); mode = 'drain'; }
    else if (overpay < -0.10) { rtp = HOUSE_TARGET - Math.min(0.05, Math.abs(overpay) * 0.3); mode = 'catchup'; }
  }
  if (t.treasury < -5000) { rtp -= Math.min(0.10, Math.abs(t.treasury) / 50000); mode = 'drain'; }
  rtp *= 0.985 + Math.random() * 0.03;
  rtp = Math.max(HOUSE_RTP_FLOOR, Math.min(HOUSE_RTP_CAP, rtp));
  HOUSE_CACHE = { rtp, ts: now, treasury: t.treasury, actualRTP, mode };
  return HOUSE_CACHE;
}

async function getPlayerTodayProfit(guestId) {
  try {
    const g = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
    if (!g.rows.length) return 0;
    const name = g.rows[0].name;
    const today = todayStr();
    const bj = await pool.query(`SELECT COALESCE(SUM(dep - out_sum), 0)::numeric AS p FROM sessions WHERE LOWER(nick)=LOWER($1) AND date=$2`, [name, today]);
    const bac = await pool.query(`SELECT COALESCE(SUM(sum), 0)::numeric AS s FROM baccarat WHERE LOWER(player)=LOWER($1) AND date=$2`, [name, today]);
    const miner = await pool.query(`SELECT COALESCE(SUM(bet - result), 0)::numeric AS p FROM game_history WHERE game='miner' AND guest_id=$1 AND created_at::date = $2::date`, [guestId, today]);
    const cases = await pool.query(`SELECT COALESCE(SUM(bet - result), 0)::numeric AS p FROM game_history WHERE game='cases' AND player_name=$1 AND created_at::date = $2::date`, [name, today]);
    const plinko = await pool.query(`SELECT COALESCE(SUM(bet - result), 0)::numeric AS p FROM game_history WHERE game='plinko' AND guest_id=$1 AND created_at::date = $2::date`, [guestId, today]);
    const ladder = await pool.query(`SELECT COALESCE(SUM(bet - result), 0)::numeric AS p FROM game_history WHERE game='ladder' AND guest_id=$1 AND created_at::date = $2::date`, [guestId, today]);
    const empire = await pool.query(`SELECT COALESCE(SUM(bet - result), 0)::numeric AS p FROM game_history WHERE game='empire_of_gold' AND guest_id=$1 AND created_at::date = $2::date`, [guestId, today]);
    return (parseFloat(bj.rows[0].p) || 0) + (parseFloat(bac.rows[0].s) || 0) +
      (parseFloat(miner.rows[0].p) || 0) + (parseFloat(cases.rows[0].p) || 0) +
      (parseFloat(plinko.rows[0].p) || 0) + (parseFloat(ladder.rows[0].p) || 0) +
      (parseFloat(empire.rows[0].p) || 0);
  } catch (e) { return 0; }
}

async function getTargetRTP(guestId) {
  const h = await getHouseRTP();
  let rtp = h.rtp;
  if (guestId) {
    try {
      const p = await getPlayerTodayProfit(guestId);
      if (p > 2000) rtp -= Math.min(0.15, (p - 2000) / 20000);
    } catch(e) {}
  }
  return Math.max(0.55, Math.min(HOUSE_RTP_CAP, rtp));
}

// === ТУРНИР: трекинг ставок ===
async function trackTournamentBet(guestId, guestName, game, betAmount, winAmount) {
  try {
    const t = await pool.query(`SELECT * FROM tournaments WHERE status='active' ORDER BY id DESC LIMIT 1`);
    if (!t.rows.length) return;
    const tour = t.rows[0];
    if (tour.end_at && new Date().toISOString() > tour.end_at) return;
    if (betAmount < (parseFloat(tour.entry_min_bet) || 30)) return;
    await pool.query(`
      INSERT INTO tournament_entries (tournament_id, guest_id, guest_name, score, bets_count)
      VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (tournament_id, guest_id)
      DO UPDATE SET score = tournament_entries.score + $4, bets_count = tournament_entries.bets_count + 1
    `, [tour.id, guestId, guestName, betAmount]);
    await pool.query(`INSERT INTO tournament_bets (tournament_id, guest_id, game, bet, win) VALUES ($1,$2,$3,$4,$5)`,
      [tour.id, guestId, game, betAmount, winAmount]);
  } catch (e) { console.error('trackTournamentBet error:', e.message); }
}

const CRASH_WAIT_AFTER_FIRST_BET = 11000;
const CRASH_CRASH_PAUSE = 2500;
const CRASH_BETTING_WINDOW = 12000;
const BOT_COUNT = 11;
let crashState = { roundId: null, crashPoint: 1, startTime: 0, status: 'idle', waitTimer: null, hasRealBet: false, forcedStop: false, plannedCrashPoint: 1, startWaitingAt: 0 };
let crashTimeouts = [];
let queuedBets = [];
const minerSessions = {};
const ladderSessions = {};

function crashClearTimers() {
  crashTimeouts.forEach(t => clearTimeout(t));
  crashTimeouts = [];
  if (crashState.waitTimer) { clearTimeout(crashState.waitTimer); crashState.waitTimer = null; }
}

const CRASH_HOUSE_EDGE = 0.0605;
const CRASH_INSTA_PROB = 1 / 33;
const CRASH_MAX_MULT    = 100;

function crashGeneratePoint() {
  const r = Math.random();
  if (r < CRASH_INSTA_PROB) return 1.00;
  const p = (r - CRASH_INSTA_PROB) / (1 - CRASH_INSTA_PROB);
  let crash = Math.floor((100 * (1 - CRASH_HOUSE_EDGE)) / (1 - p)) / 100;
  if (crash > CRASH_MAX_MULT) crash = CRASH_MAX_MULT;
  return Math.max(1.00, crash);
}

async function crashGeneratePointAsync(guestId) {
  const targetRTP = await getTargetRTP(guestId);
  const instaProb = 0.05;
  const r = Math.random();
  if (r < instaProb) return 1.00;
  const p = (r - instaProb) / (1 - instaProb);
  let crash = Math.floor((100 * targetRTP) / (1 - p)) / 100;
  if (crash > CRASH_MAX_MULT) crash = CRASH_MAX_MULT;
  return Math.max(1.01, Math.round(crash * 100) / 100);
}

let bots = [];
function botInit() {
  const ranks = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'VIP'];
  function generateCardId() { let s = ''; for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 10); if (s[0] === '0') s = '1' + s.slice(1); return s; }
  bots = []; const usedIds = new Set();
  for (let i = 0; i < BOT_COUNT; i++) {
    let id; do { id = generateCardId(); } while (usedIds.has(id));
    usedIds.add(id);
    const rank = ranks[Math.floor(Math.random() * ranks.length)];
    bots.push({ id, rank, masked: id.slice(0, 4) + '••••' });
  }
}
async function botPlaceBet(bot) {
  const amount = [10, 20, 25, 50, 100][Math.floor(Math.random() * 5)];
  try {
    const r = await pool.query(`INSERT INTO crash_bets (round_id, player_id, player_name, player_rank, amount) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [crashState.roundId, 'BOT' + bot.id, bot.masked, bot.rank, amount]);
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
    try { await pool.query(`UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2 AND cashed_out=false`, [mult, betId]); } catch(e) {}
  }, ms));
}

async function crashStartWaiting() {
  try {
    crashClearTimers();
    let cp;
    try {
      const forceRes = await pool.query(`SELECT value FROM settings WHERE key='crash_force_next'`);
      if (forceRes.rows.length && forceRes.rows[0].value) {
        const forced = parseFloat(forceRes.rows[0].value);
        if (isFinite(forced) && forced >= 1.0 && forced <= 100) {
          cp = forced;
          await pool.query(`UPDATE settings SET value='' WHERE key='crash_force_next'`);
        } else { cp = await crashGeneratePointAsync(null); }
      } else { cp = await crashGeneratePointAsync(null); }
    } catch(e) { cp = crashGeneratePoint(); }

    try {
      const recent = await pool.query(`SELECT crash_point FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT 3`);
      const lastThree = recent.rows.map(r => parseFloat(r.crash_point));
      if (lastThree.length === 3 && lastThree.every(c => c <= 1.01)) {
        cp = Math.round((1.5 + Math.random() * 1.5) * 100) / 100;
      }
    } catch(e) {}

    try { await pool.query(`UPDATE crash_rounds SET status='crashed' WHERE status IN ('waiting', 'flying')`); } catch(e) {}
    const r = await pool.query(`INSERT INTO crash_rounds (crash_point, status) VALUES ($1, 'waiting') RETURNING id`, [cp]);
    crashState.roundId = r.rows[0].id;
    crashState.crashPoint = cp;
    crashState.startTime = 0;
    crashState.status = 'waiting';
    crashState.hasRealBet = false;
    crashState.waitTimer = null;
    crashState.forcedStop = false;
    crashState.plannedCrashPoint = cp;
    crashState.startWaitingAt = Date.now();

    crashTimeouts.push(setTimeout(() => {
      if (crashState.status === 'waiting') crashStartFlight();
    }, CRASH_BETTING_WINDOW));

    if (queuedBets.length > 0) {
      const toApply = queuedBets.slice(); queuedBets = [];
      for (const q of toApply) {
        try {
          const debited = await debitBet(q.player_id, q.amount);
          if (!debited) continue;
          const guestRes = await pool.query(`SELECT id, rank FROM guests WHERE id=$1`, [q.player_id]);
          if (!guestRes.rows.length) continue;
          const guest = guestRes.rows[0];
          const s = String(guest.id);
          const maskName = s.length <= 4 ? s : s.slice(0, 4) + '••••';
          const isBonus = debited.fromBonus > 0 && debited.fromDeposit === 0;
          await pool.query(`INSERT INTO crash_bets (round_id, player_id, player_name, player_rank, amount, is_bonus) VALUES ($1,$2,$3,$4,$5,$6)`, [crashState.roundId, q.player_id, maskName, guest.rank || 'Bronze', q.amount, isBonus]);
          crashState.hasRealBet = true;
        } catch(e){}
      }
      if (crashState.hasRealBet) tryStartFlightCountdown();
    }
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
    const delay = 3000 + Math.random() * 3000;
    crashTimeouts.push(setTimeout(async () => {
      if (crashState.status !== 'waiting') return;
      const bet = await botPlaceBet(bot);
      if (bet) { const target = 1.2 + Math.random() * 3.8; scheduleBotCashout(bet.id, target); tryStartFlightCountdown(); }
    }, delay));
  });
}
function tryStartFlightCountdown() {
  if (crashState.status !== 'waiting') return;
  if (crashState.waitTimer) return;
  const elapsed = Date.now() - (crashState.startWaitingAt || Date.now());
  const remaining = Math.max(0, CRASH_BETTING_WINDOW - elapsed);
  crashState.waitTimer = setTimeout(() => {
    if (crashState.status === 'waiting') crashStartFlight();
  }, remaining);
}
async function crashStartFlight() {
  try {
    crashState.status = 'flying';
    crashState.startTime = Date.now();
    crashState.forcedStop = false;
    crashState.plannedCrashPoint = crashState.crashPoint;
    await pool.query(`UPDATE crash_rounds SET status='flying', start_time=$1 WHERE id=$2`, [crashState.startTime, crashState.roundId]);
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
    try { await pool.query(`UPDATE crash_rounds SET status='crashed', end_time=$1, crash_point=$2 WHERE id=$3`, [endTime, crashState.crashPoint, crashState.roundId]); } catch(e) {}
    try {
      const betsRes = await pool.query(`SELECT amount, cashout_mult, cashed_out, is_bonus FROM crash_bets WHERE round_id = $1 AND (player_id IS NULL OR player_id NOT LIKE 'BOT%')`, [crashState.roundId]);
      let totalBet = 0, totalWin = 0;
      for (const bet of betsRes.rows) {
        if (bet.is_bonus) continue;
        const amt = parseFloat(bet.amount) || 0;
        totalBet += amt;
        if (bet.cashed_out) totalWin += amt * (parseFloat(bet.cashout_mult) || 0);
      }
      const net = totalBet - totalWin;
      if (totalBet > 0) {
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Crash Round #${crashState.roundId}`]);
      }
    } catch(err) {}
    crashTimeouts.push(setTimeout(() => crashStartWaiting(), CRASH_CRASH_PAUSE));
  } catch (e) {
    console.error('ОШИБКА crashEndRound:', e.message);
    crashTimeouts.push(setTimeout(() => crashStartWaiting(), 3000));
  }
}

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, date TEXT, nick TEXT, decks INTEGER, dep NUMERIC DEFAULT 0, out_sum NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0, result NUMERIC DEFAULT 0, dealer TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS baccarat (id SERIAL PRIMARY KEY, date TEXT, player TEXT, bet TEXT, sum NUMERIC DEFAULT 0, result TEXT, dealer TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS deposits (id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT, sum NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', seen BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, date TEXT, nick TEXT, email TEXT, sum NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS payouts (id SERIAL PRIMARY KEY, date TEXT, dealer TEXT, sum NUMERIC DEFAULT 0, note TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS players (id SERIAL PRIMARY KEY, nick TEXT UNIQUE, vip BOOLEAN DEFAULT FALSE, blocked BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS games (id SERIAL PRIMARY KEY, name TEXT, provider TEXT, min_sum NUMERIC DEFAULT 10, max_sum NUMERIC DEFAULT 100, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS audit (id SERIAL PRIMARY KEY, time TEXT, user_name TEXT, action TEXT, details TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT, role TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS dealers (id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS online (id SERIAL PRIMARY KEY, date TEXT, type TEXT, sum NUMERIC DEFAULT 0, note TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, title TEXT, body TEXT, date TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS dealer_reviews (id SERIAL PRIMARY KEY, date TEXT, guest_id TEXT, guest_name TEXT, dealer_name TEXT, stars INTEGER DEFAULT 0, comment TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, name TEXT, rank TEXT DEFAULT 'Bronze', points INTEGER DEFAULT 0, visits INTEGER DEFAULT 0, bonus_text TEXT, bonus_code TEXT, pass TEXT DEFAULT '1234', bonus_balance NUMERIC DEFAULT 0, deposit_balance NUMERIC DEFAULT 0, wagering_required NUMERIC DEFAULT 0, wagering_done NUMERIC DEFAULT 0, last_rank TEXT DEFAULT 'Bronze', daily_level INT DEFAULT 0, daily_last_claim DATE, wheel_last_spin DATE, pending_bonus NUMERIC DEFAULT 0, last_visit TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS crash_rounds (id SERIAL PRIMARY KEY, crash_point NUMERIC NOT NULL, start_time BIGINT, end_time BIGINT, status TEXT DEFAULT 'waiting', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS crash_bets (id SERIAL PRIMARY KEY, round_id INTEGER REFERENCES crash_rounds(id) ON DELETE CASCADE, player_id TEXT, player_name TEXT, player_rank TEXT DEFAULT 'Bronze', amount NUMERIC NOT NULL, cashout_mult NUMERIC, cashed_out BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cases_log (id SERIAL PRIMARY KEY, date TEXT, guest_id TEXT, guest_name TEXT, case_name TEXT, case_price NUMERIC DEFAULT 0, prize NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS game_history (id SERIAL PRIMARY KEY, game TEXT, player_name TEXT, bet NUMERIC DEFAULT 0, result NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS dealer_balance (dealer_id INTEGER PRIMARY KEY, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS dealer_daily (id SERIAL PRIMARY KEY, dealer_id INTEGER, date TEXT, hands INTEGER DEFAULT 0, UNIQUE(dealer_id, date));
      CREATE TABLE IF NOT EXISTS dealer_tasks (id SERIAL PRIMARY KEY, dealer_id INTEGER, date TEXT, task_id TEXT, claimed BOOLEAN DEFAULT FALSE, reward NUMERIC DEFAULT 0, claimed_at TIMESTAMP DEFAULT NOW(), UNIQUE(dealer_id, date, task_id));
      CREATE TABLE IF NOT EXISTS dealer_silence (id SERIAL PRIMARY KEY, dealer_id INTEGER UNIQUE, week_start BIGINT, incident BOOLEAN DEFAULT FALSE, updated_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS dealer_withdrawals (id SERIAL PRIMARY KEY, dealer_id INTEGER, sum NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cash_safe (id SERIAL PRIMARY KEY, dealer_id INTEGER, dealer_name TEXT, guest_id TEXT, guest_name TEXT, sum NUMERIC DEFAULT 0, type TEXT DEFAULT 'in', status TEXT DEFAULT 'open', date TEXT, handed_at TIMESTAMP, accepted_at TIMESTAMP, real_sum NUMERIC DEFAULT 0, diff NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS promo_codes (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'fixed', value NUMERIC DEFAULT 0, max_uses INT DEFAULT 0, used_count INT DEFAULT 0, min_deposit NUMERIC DEFAULT 0, expires_at TIMESTAMP, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS promo_uses (id SERIAL PRIMARY KEY, promo_id INT, guest_id TEXT, guest_name TEXT, amount NUMERIC DEFAULT 0, used_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS miner_force_lose_players (guest_id TEXT PRIMARY KEY, guest_name TEXT, updated_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS roulette_sessions (id SERIAL PRIMARY KEY, dealer TEXT NOT NULL, nick TEXT NOT NULL, bet_type TEXT NOT NULL, bet_number INTEGER, bet NUMERIC NOT NULL, win NUMERIC NOT NULL, won INTEGER, bet_source TEXT DEFAULT 'real', date TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS tournaments (id SERIAL PRIMARY KEY, title TEXT NOT NULL, prize_pool NUMERIC NOT NULL DEFAULT 100, prize_type TEXT DEFAULT 'bonus', wager_multiplier NUMERIC DEFAULT 3, entry_min_bet NUMERIC DEFAULT 30, entry_min_bets INTEGER DEFAULT 5, min_participants INTEGER DEFAULT 3, start_at TEXT, end_at TEXT, status TEXT DEFAULT 'active', winner_id TEXT, winner_name TEXT, winner_score NUMERIC, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS tournament_entries (id SERIAL PRIMARY KEY, tournament_id INTEGER NOT NULL, guest_id TEXT NOT NULL, guest_name TEXT, score NUMERIC DEFAULT 0, bets_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(tournament_id, guest_id));
      CREATE TABLE IF NOT EXISTS tournament_bets (id SERIAL PRIMARY KEY, tournament_id INTEGER, guest_id TEXT, game TEXT, bet NUMERIC, win NUMERIC, created_at TIMESTAMP DEFAULT NOW());
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
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_visit TIMESTAMP DEFAULT NOW()`,
      `ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS player_rank TEXT DEFAULT 'Bronze'`,
      `ALTER TABLE crash_bets ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE dealer_withdrawals ADD COLUMN IF NOT EXISTS card TEXT`,
      `ALTER TABLE dealer_withdrawals ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0`,
      `ALTER TABLE dealer_withdrawals ADD COLUMN IF NOT EXISTS net NUMERIC DEFAULT 0`,
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS mines INT`,
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS revealed INT`,
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS multiplier NUMERIC DEFAULT 0`,
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS status TEXT`,
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS guest_id TEXT`
    ];
    for (const c of cols){ try { await pool.query(c); } catch(e){} }
    const own = await pool.query(`SELECT * FROM employees WHERE role = 'owner'`);
    if(own.rows.length === 0){ await pool.query(`INSERT INTO employees (name, login, pass, role) VALUES ($1,$2,$3,$4)`, ['Владелец', 'Owner', '56UpahoS', 'owner']); }
    const dlCount = await pool.query(`SELECT COUNT(*) FROM dealers`);
    if(parseInt(dlCount.rows[0].count,10) === 0){ await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1,$2,$3)`, ['Дилер', 'dealer', '56UpahoS']); }
    const jpCheck = await pool.query(`SELECT * FROM settings WHERE key IN ('jackpot', 'jackpot_last_tick')`);
    if(!jpCheck.rows.find(r => r.key === 'jackpot')){ await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot', '0')`); }
    if(!jpCheck.rows.find(r => r.key === 'jackpot_last_tick')){ await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot_last_tick', $1)`, [Date.now().toString()]); }
    await pool.query(`INSERT INTO settings (key, value) VALUES ('crash_force_next', '') ON CONFLICT (key) DO NOTHING`);
    await pool.query(`INSERT INTO settings (key, value) VALUES ('miner_force_lose', '0') ON CONFLICT (key) DO NOTHING`);
    console.log('База готова');
    botInit();
    try {
      const activeRes = await pool.query(`SELECT id FROM crash_rounds WHERE status IN ('waiting', 'flying')`);
      if (activeRes.rows.length > 0) await pool.query(`UPDATE crash_rounds SET status='crashed' WHERE status IN ('waiting', 'flying')`);
    } catch(e) {}
    crashStartWaiting();
    startTournamentAutoFinish();
  } catch (e) {
    console.error('Ошибка initDB:', e.message);
    setTimeout(initDB, 5000);
  }
}
initDB();

// === АВТОЗАВЕРШЕНИЕ ТУРНИРОВ ===
function startTournamentAutoFinish() {
  setInterval(async () => {
    try {
      const t = await pool.query(`SELECT * FROM tournaments WHERE status='active' ORDER BY id DESC LIMIT 1`);
      if (!t.rows.length) return;
      const tour = t.rows[0];
      if (!tour.end_at) return;
      if (new Date().toISOString() <= tour.end_at) return;

      const cntRow = await pool.query(`SELECT COUNT(*)::int AS cnt FROM tournament_entries WHERE tournament_id=$1`, [tour.id]);
      const participants = cntRow.rows[0].cnt || 0;
      const minP = tour.min_participants || 3;

      if (participants < minP) {
        await pool.query(`UPDATE tournaments SET status='cancelled' WHERE id=$1`, [tour.id]);
        console.log(`Tournament #${tour.id} auto-cancelled (${participants}/${minP})`);
        return;
      }
      const winner = await pool.query(`SELECT * FROM tournament_entries WHERE tournament_id=$1 ORDER BY score DESC LIMIT 1`, [tour.id]);
      if (!winner.rows.length) { await pool.query(`UPDATE tournaments SET status='cancelled' WHERE id=$1`, [tour.id]); return; }
      const w = winner.rows[0];
      await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`, [tour.prize_pool, w.guest_id]);
      await pool.query(`UPDATE tournaments SET status='finished', winner_id=$1, winner_name=$2, winner_score=$3 WHERE id=$4`,
        [w.guest_id, w.guest_name, w.score, tour.id]);
      console.log(`Tournament #${tour.id} auto-finished. Winner: ${w.guest_name} (${w.score})`);
    } catch (e) { console.error('auto-finish tournament:', e.message); }
  }, 60 * 1000);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.wasm': 'application/wasm'
};
function sendJSON(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
function parseBody(req){ return new Promise((resolve)=>{ let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch(e){ resolve({}); } }); }); }

async function accruePointsByNick(nick, rubAmount, source){
  if(!nick || !rubAmount || rubAmount <= 0) return null;
  const g = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nick.trim()]);
  if(g.rows.length === 0) return null;
  const guest = g.rows[0];
  const addPoints = Math.floor(rubAmount * POINTS_PER_RUB);
  if(addPoints <= 0) return null;
  const newPoints = (guest.points || 0) + addPoints;
  const prevRank = guest.rank || 'Bronze';
  const newRank = rankByPoints(newPoints);
  let giftMoney = 0; let giftText = guest.bonus_text || ''; let giftCode = guest.bonus_code || '';
  const prevIdx = RANK_ORDER.indexOf(prevRank);
  const newIdx = RANK_ORDER.indexOf(newRank);
  if (newIdx > prevIdx){
    for (let i = prevIdx + 1; i <= newIdx; i++){ giftMoney += RANKS[RANK_ORDER[i]].gift; }
    giftText = `Поздравляем с достижением ранга ${newRank}!`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }
  const addWagerReqRank = giftMoney * 5;
  await pool.query(`UPDATE guests SET points = $1, rank = $2, last_rank = $3, bonus_text = $4, bonus_code = $5, bonus_balance = bonus_balance + $6, wagering_required = wagering_required + $7 WHERE id = $8`, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReqRank, guest.id]);
  await pool.query(`UPDATE guests SET wagering_done = wagering_done + $1 WHERE id=$2`, [rubAmount, guest.id]);
  return { guestId: guest.id, newPoints, newRank, giftMoney };
}

async function addBalanceByNick(nick, amount, isBonus = false){
  if(!nick || !amount) return false;
  const g = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [String(nick).trim()]);
  if(g.rows.length === 0) return false;
  if (isBonus) await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`, [parseFloat(amount) || 0, g.rows[0].id]);
  else await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2`, [parseFloat(amount) || 0, g.rows[0].id]);
  return true;
}

async function getGuestById(id){ const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id)]); return r.rows[0] || null; }

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    // === РУЛЕТКА ===
    if (url === '/api/sessions/roulette' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealer = u.searchParams.get('dealer');
      try {
        if (dealer) {
          const r = await pool.query(`SELECT * FROM roulette_sessions WHERE dealer = $1 ORDER BY id DESC LIMIT 500`, [dealer]);
          return sendJSON(res, 200, r.rows);
        } else {
          const r = await pool.query(`SELECT * FROM roulette_sessions ORDER BY id DESC LIMIT 1000`);
          return sendJSON(res, 200, r.rows);
        }
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/sessions/roulette' && method === 'POST') {
      const b = await parseBody(req);
      const { dealer, nick, bet_type, bet_number, bet, win, won, bet_source = 'real' } = b;
      if (!dealer || !nick || !bet_type || bet == null || win == null) {
        return sendJSON(res, 400, { error: 'Не все поля' });
      }
      const betAmount = parseFloat(bet) || 0;
      let winAmount = parseFloat(win) || 0;
      if (winAmount > betAmount * 30) return sendJSON(res, 400, { error: 'Выигрыш превышает максимум' });

      try {
        const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nick]);
        if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Гость не найден' });
        const guest = gRes.rows[0];

        if (bet_source === 'bonus') {
          if ((parseFloat(guest.bonus_balance) || 0) < betAmount) {
            return sendJSON(res, 400, { error: 'Недостаточно бонусных фишек' });
          }
          await pool.query(`UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2`, [betAmount, guest.id]);
          if (winAmount > 0) {
            const realWin = Math.min(winAmount, betAmount);
            await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2`, [realWin, guest.id]);
            winAmount = realWin;
          }
        } else {
          if ((parseFloat(guest.deposit_balance) || 0) < betAmount) {
            return sendJSON(res, 400, { error: 'Недостаточно реальных фишек' });
          }
          await pool.query(`UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2`, [betAmount, guest.id]);
          if (winAmount > 0) {
            await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2`, [winAmount, guest.id]);
          }
        }

        const r = await pool.query(`
          INSERT INTO roulette_sessions (dealer, nick, bet_type, bet_number, bet, win, won, bet_source, date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
        `, [dealer, nick, bet_type, bet_number ?? null, betAmount, winAmount, won ? 1 : 0, bet_source, todayStr()]);

        await trackTournamentBet(guest.id, guest.name, 'roulette', betAmount, winAmount);

        if (bet_source === 'real') {
          const net = betAmount - winAmount;
          await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
            [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Roulette ${bet_type} (${nick})`]);
        }

        return sendJSON(res, 200, { id: r.rows[0].id, ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url.startsWith('/api/sessions/roulette/') && method === 'DELETE') {
      const id = url.split('/')[4];
      try { await pool.query(`DELETE FROM roulette_sessions WHERE id=$1`, [id]); return sendJSON(res, 200, { ok: true }); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ТУРНИР ===
    if (url === '/api/tournament/active' && method === 'GET') {
      try {
        const t = await pool.query(`SELECT * FROM tournaments WHERE status='active' ORDER BY id DESC LIMIT 1`);
        if (!t.rows.length) return sendJSON(res, 200, { tournament: null });
        const tour = t.rows[0];
        const cntRow = await pool.query(`SELECT COUNT(*)::int AS cnt FROM tournament_entries WHERE tournament_id=$1`, [tour.id]);
        const participants = cntRow.rows[0].cnt || 0;
        const minP = tour.min_participants || 3;
        const top = await pool.query(`SELECT guest_name, score, bets_count FROM tournament_entries WHERE tournament_id=$1 ORDER BY score DESC LIMIT 10`, [tour.id]);
        return sendJSON(res, 200, {
          tournament: tour, top: top.rows, participants, min_participants: minP,
          can_finish: participants >= minP,
          effective_prize: participants >= minP ? parseFloat(tour.prize_pool) : 0
        });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/tournament/join' && method === 'POST') {
      const b = await parseBody(req);
      const card = String(b.card || '').trim();
      if (!card) return sendJSON(res, 400, { error: 'Введи номер карты' });
      try {
        const t = await pool.query(`SELECT * FROM tournaments WHERE status='active' ORDER BY id DESC LIMIT 1`);
        if (!t.rows.length) return sendJSON(res, 400, { error: 'Нет активного турнира' });
        const tour = t.rows[0];
        const g = await pool.query(`SELECT * FROM guests WHERE id=$1`, [card]);
        if (!g.rows.length) return sendJSON(res, 404, { error: 'Карта не найдена' });
        const guest = g.rows[0];
        const existing = await pool.query(`SELECT * FROM tournament_entries WHERE tournament_id=$1 AND guest_id=$2`, [tour.id, guest.id]);
        if (existing.rows.length) return sendJSON(res, 200, { ok: true, already: true });
        await pool.query(`INSERT INTO tournament_entries (tournament_id, guest_id, guest_name, score, bets_count) VALUES ($1,$2,$3,0,0)`,
          [tour.id, guest.id, guest.name]);
        return sendJSON(res, 200, { ok: true, already: false });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/admin/tournaments' && method === 'GET') {
      try { const r = await pool.query(`SELECT * FROM tournaments ORDER BY id DESC LIMIT 50`); return sendJSON(res, 200, r.rows); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/admin/tournament/create' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const title = String(b.title || 'Турнир недели');
      const prize = parseFloat(b.prize_pool) || 100;
      const days = parseInt(b.days, 10) || 3;
      const start = new Date().toISOString();
      const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      try {
        await pool.query(`UPDATE tournaments SET status='cancelled' WHERE status='active'`);
        const r = await pool.query(`
          INSERT INTO tournaments (title, prize_pool, prize_type, wager_multiplier, entry_min_bet, entry_min_bets, min_participants, start_at, end_at, status)
          VALUES ($1,$2,'bonus',3,30,5,3,$3,$4,'active') RETURNING id
        `, [title, prize, start, end]);
        return sendJSON(res, 200, { id: r.rows[0].id, ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/admin/tournament/finish' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      try {
        const t = await pool.query(`SELECT * FROM tournaments WHERE status='active' ORDER BY id DESC LIMIT 1`);
        if (!t.rows.length) return sendJSON(res, 404, { error: 'Нет активного турнира' });
        const tour = t.rows[0];
        const cntRow = await pool.query(`SELECT COUNT(*)::int AS cnt FROM tournament_entries WHERE tournament_id=$1`, [tour.id]);
        const participants = cntRow.rows[0].cnt || 0;
        const minP = tour.min_participants || 3;
        if (participants < minP) {
          return sendJSON(res, 400, { error: `Мало участников: ${participants}/${minP}`, participants, min_participants: minP });
        }
        const winner = await pool.query(`SELECT * FROM tournament_entries WHERE tournament_id=$1 ORDER BY score DESC LIMIT 1`, [tour.id]);
        if (!winner.rows.length) return sendJSON(res, 400, { error: 'Нет участников' });
        const w = winner.rows[0];
        await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`, [tour.prize_pool, w.guest_id]);
        await pool.query(`UPDATE tournaments SET status='finished', winner_id=$1, winner_name=$2, winner_score=$3 WHERE id=$4`,
          [w.guest_id, w.guest_name, w.score, tour.id]);
        return sendJSON(res, 200, {
          ok: true, winner: w.guest_name, score: w.score,
          prize: parseFloat(tour.prize_pool),
          wager_required: parseFloat(tour.prize_pool) * (parseFloat(tour.wager_multiplier) || 3)
        });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/admin/tournament/cancel' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      try { await pool.query(`UPDATE tournaments SET status='cancelled' WHERE id=$1`, [b.id]); return sendJSON(res, 200, { ok: true }); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === HEALTH ===
    if (url === '/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
    }

    // ... остальные эндпоинты (jackpot, house stats, guests, deposits, withdrawals, games, crash, miner, cases, ladder, plinko, livekit, socket.io) 
    // ОСТАЛЬНОЙ КОД ВСТАВЬ ИЗ СВОЕГО ТЕКУЩЕГО server.js — он не меняется, я его не трогал.
    // Найди в своём server.js блоки:
    //   if (url === '/api/livekit/token' ...)
    //   if (url === '/api/jackpot' ...)
    //   ... и так далее ...
    // и просто вставь их сюда, ПЕРЕД блоком "let file = url === '/' ..." (раздача статики).

    // ВАЖНО: вставь сюда ВСЕ остальные эндпоинты из своего server.js — они уже работают,
    // я их не менял. Изменения только в блоках рулетки, турнира и trackTournamentBet.

    // === РАЗДАЧА СТАТИКИ (без изменений) ===
    let file = url === '/' ? '/index.html' : decodeURIComponent(url);
    const safeRelative = path.normalize(file).replace(/^(\.\.[\/\\])+/, '').replace(/^[\/\\]+/, '');
    const filePath = path.join(__dirname, safeRelative);
    if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': mime };
    if (/^image\//.test(mime)) headers['Cache-Control'] = 'public, max-age=3600';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
    return;
  } catch (e) {
    console.error('Ошибка сервера:', e.message);
    try { sendJSON(res, 500, { error: e.message }); } catch(err) {}
  }
});

/* ============ LIVEKIT + БЛЭКДЖЕК ============ */
const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY    || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL        = process.env.LIVEKIT_URL        || '';

async function makeLivekitToken(identity, role) {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) throw new Error('LiveKit keys not configured');
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: '4h' });
  at.addGrant({ roomJoin: true, room: 'kingwin-table-1', canPublish: role === 'dealer', canSubscribe: true, canPublishData: false });
  return await at.toJwt();
}

const SEATS = 4, MIN_BET = 10, MAX_BET = 5000;
const table = { seats: Array(SEATS).fill(null), dealerCards: [], dealerHidden: true, phase: 'waiting', betDeadline: 0, timer: null, roundId: 0 };
const io = new SocketServer(server, { cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET','POST'] }, transports: ['polling','websocket'] });

function handValue(cards) {
  let sum = 0, aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; sum += 11; } else if (['J','Q','K'].includes(c.r)) sum += 10; else sum += parseInt(c.r); }
  while (sum > 21 && aces > 0) { sum -= 10; aces--; }
  return sum;
}
function isBlackjack(cards) { return cards.length === 2 && handValue(cards) === 21; }

function publicState(forSocketId = null) {
  const hideDealer = table.phase !== 'payout' && table.phase !== 'dealer';
  const dealerCards = table.dealerCards.map((c, i) => (hideDealer && i === 1) ? { r:'?', s:'?' } : c);
  return { phase: table.phase, betDeadline: table.betDeadline, roundId: table.roundId, dealerCards, dealerTotal: hideDealer && table.dealerCards.length > 0 ? handValue([table.dealerCards[0]]) : handValue(table.dealerCards), seats: table.seats.map((s, i) => { if (!s) return null; return { idx: i, name: s.name, bet: s.bet, cards: s.cards, total: handValue(s.cards), stood: s.stood, busted: s.busted, doubled: s.doubled, wantsCard: s.wantsCard || false, result: s.result || null, isMe: s.socketId === forSocketId }; }) };
}
function broadcastState() { for (const [sid, sock] of io.sockets.sockets) sock.emit('state', publicState(sid)); }
function clearTableTimer() { if (table.timer) { clearTimeout(table.timer); table.timer = null; } }

async function getGuestBalance(guestId) {
  const r = await pool.query('SELECT bonus_balance, deposit_balance FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return null;
  const g = r.rows[0];
  return { bonus: parseFloat(g.bonus_balance) || 0, deposit: parseFloat(g.deposit_balance) || 0, total: (parseFloat(g.bonus_balance) || 0) + (parseFloat(g.deposit_balance) || 0) };
}
async function withdrawBet(guestId, amount) {
  const r = await pool.query('SELECT bonus_balance, deposit_balance FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return false;
  let bonus = parseFloat(r.rows[0].bonus_balance) || 0;
  let dep = parseFloat(r.rows[0].deposit_balance) || 0;
  if (bonus + dep < amount) return false;
  let rem = amount;
  if (bonus >= rem) { bonus -= rem; rem = 0; } else { rem -= bonus; bonus = 0; dep -= rem; }
  await pool.query('UPDATE guests SET bonus_balance=$1, deposit_balance=$2 WHERE id=$3', [bonus, dep, guestId]);
  return true;
}
function dealerStartBetting() {
  clearTableTimer();
  table.phase = 'betting';
  table.dealerCards = [];
  table.dealerHidden = true;
  table.betDeadline = Date.now() + 12000;
  for (const s of table.seats) if (s) { s.cards = []; s.stood = false; s.busted = false; s.doubled = false; s.result = null; s.bet = 0; s.wantsCard = false; }
  broadcastState();
  io.emit('dealerMsg', 'Приём ставок открыт (12 сек)');
  table.timer = setTimeout(() => {
    if (table.phase === 'betting') {
      const active = table.seats.filter(s => s && s.bet > 0);
      if (active.length === 0) { table.phase = 'waiting'; broadcastState(); io.emit('dealerMsg', 'Нет ставок'); return; }
      table.phase = 'dealing'; broadcastState(); io.emit('dealerMsg', 'Раздавайте карты');
    }
  }, 12000);
}
function dealerAddCardToSeat(seatIdx, card) {
  const s = table.seats[seatIdx];
  if (!s) return;
  s.cards.push(card); s.wantsCard = false;
  if (handValue(s.cards) > 21) { s.busted = true; s.stood = true; }
  if (s.cards.length >= 2 && isBlackjack(s.cards)) s.stood = true;
  broadcastState(); checkAllPlayersDone();
}
function dealerAddCardToSelf(card) { table.dealerCards.push(card); broadcastState(); }
function dealerRevealCard() { table.dealerHidden = false; table.phase = 'dealer'; broadcastState(); io.emit('dealerMsg', 'Вторая карта дилера открыта'); }
async function checkAllPlayersDone() {
  if (table.phase !== 'dealing' && table.phase !== 'playing') return;
  const active = table.seats.filter(s => s && s.bet > 0);
  if (active.length === 0) return;
  if (!active.every(s => s.cards.length >= 2)) return;
  if (!active.every(s => s.stood || s.busted)) return;
  io.emit('dealerMsg', 'Все игроки закончили.');
}
async function dealerFinishRound() {
  table.dealerHidden = false;
  table.phase = 'payout';
  const dv = handValue(table.dealerCards);
  const dealerBJ = isBlackjack(table.dealerCards);
  for (const s of table.seats) {
    if (!s || s.bet <= 0) continue;
    const pv = handValue(s.cards);
    const playerBJ = isBlackjack(s.cards);
    let payout = 0, result = 'lose';
    if (pv > 21) result = 'bust';
    else if (playerBJ && !dealerBJ) { result = 'blackjack'; payout = Math.floor(s.bet * 2.5); }
    else if (dealerBJ && !playerBJ) result = 'lose';
    else if (playerBJ && dealerBJ) { result = 'push'; payout = s.bet; }
    else if (dv > 21 || pv > dv) { result = 'win'; payout = s.bet * 2; }
    else if (pv === dv) { result = 'push'; payout = s.bet; }
    s.result = result;
    if (payout > 0 && s.guestId) await creditWin(s.guestId, payout, s.bet);
    try { await pool.query(`INSERT INTO sessions (date, nick, decks, dep, out_sum, fee, net, result, dealer) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [todayStr(), s.name, 6, s.bet, payout, 0, s.bet - payout, s.bet - payout, 'live-dealer']); } catch(e) {}
    try { const net = s.bet - payout; await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Live BJ (${s.name})`]); } catch(e) {}
  }
  broadcastState();
  io.emit('roundResult', publicState());
  io.emit('dealerMsg', 'Раунд завершён. Через 8 секунд — новый.');
  table.timer = setTimeout(() => dealerStartBetting(), 8000);
}

io.on('connection', (socket) => {
  socket.emit('state', publicState(socket.id));
  socket.on('sit', async ({ guestId, name, seat }) => {
    try {
      if (seat < 0 || seat >= SEATS) return socket.emit('err', 'Неверное место');
      if (table.seats[seat]) return socket.emit('err', 'Место занято');
      if (!['waiting','betting'].includes(table.phase)) return socket.emit('err', 'Раунд идёт');
      if (!guestId) return socket.emit('err', 'Войдите');
      const bal = await getGuestBalance(guestId);
      if (!bal) return socket.emit('err', 'Гость не найден');
      if (bal.total <= 0) return socket.emit('err', 'Нет средств');
      for (let i = 0; i < SEATS; i++) if (table.seats[i] && table.seats[i].socketId === socket.id) table.seats[i] = null;
      table.seats[seat] = { socketId: socket.id, guestId: String(guestId), name: String(name || 'Гость'), bet: 0, cards: [], stood: false, busted: false, doubled: false, result: null, wantsCard: false };
      socket.data.seat = seat;
      broadcastState();
      io.emit('dealerMsg', `${name} сел на ${seat+1}`);
      if (table.phase === 'waiting') dealerStartBetting();
    } catch(e) { socket.emit('err', e.message); }
  });
  socket.on('leave', () => {
    const seat = socket.data.seat;
    if (seat == null) return;
    if (['dealing','playing','dealer','payout'].includes(table.phase)) return socket.emit('err', 'Нельзя встать');
    table.seats[seat] = null; socket.data.seat = null; broadcastState();
  });
  socket.on('bet', async ({ amount }) => {
    try {
      const seat = socket.data.seat;
      if (seat == null) return socket.emit('err', 'Сядьте');
      const s = table.seats[seat];
      if (!s || table.phase !== 'betting') return socket.emit('err', 'Нельзя ставить');
      const amt = parseInt(amount, 10) || 0;
      if (amt < MIN_BET || amt > MAX_BET) return socket.emit('err', `Ставка ${MIN_BET}–${MAX_BET}`);
      const bal = await getGuestBalance(s.guestId);
      if (!bal || bal.total < amt) return socket.emit('err', 'Недостаточно');
      const ok = await withdrawBet(s.guestId, amt);
      if (!ok) return socket.emit('err', 'Ошибка');
      s.bet = amt;
      broadcastState();
      io.emit('dealerMsg', `${s.name} поставил ${amt} ₽`);
    } catch(e) { socket.emit('err', e.message); }
  });
  socket.on('hit', () => {
    const seat = socket.data.seat;
    if (seat == null) return;
    const s = table.seats[seat];
    if (!s || !['dealing','playing'].includes(table.phase) || s.stood || s.busted) return;
    s.wantsCard = true; broadcastState(); io.emit('dealerMsg', `${s.name} просит карту`);
  });
  socket.on('stand', () => {
    const seat = socket.data.seat;
    if (seat == null) return;
    const s = table.seats[seat];
    if (!s || !['dealing','playing'].includes(table.phase) || s.stood || s.busted) return;
    s.stood = true; s.wantsCard = false; broadcastState();
    io.emit('dealerMsg', `${s.name} сказал «Стоп»`);
    checkAllPlayersDone();
  });
  socket.on('double', async () => {
    const seat = socket.data.seat;
    if (seat == null) return;
    const s = table.seats[seat];
    if (!s || !['dealing','playing'].includes(table.phase) || s.cards.length !== 2 || s.stood || s.busted) return;
    const bal = await getGuestBalance(s.guestId);
    if (!bal || bal.total < s.bet) return socket.emit('err', 'Недостаточно');
    const ok = await withdrawBet(s.guestId, s.bet);
    if (!ok) return socket.emit('err', 'Ошибка');
    s.bet += s.bet; s.doubled = true; s.wantsCard = true;
    broadcastState(); io.emit('dealerMsg', `${s.name} удвоил`);
  });
  socket.on('dealer:startBetting', () => { if (['dealing','playing','dealer','payout'].includes(table.phase)) return socket.emit('err', 'Раунд идёт'); dealerStartBetting(); });
  socket.on('dealer:deal', () => {
    if (table.phase !== 'betting' && table.phase !== 'waiting') return;
    const active = table.seats.filter(s => s && s.bet > 0);
    if (active.length === 0) return socket.emit('err', 'Нет ставок');
    table.phase = 'dealing'; broadcastState(); io.emit('dealerMsg', 'Раздавайте');
  });
  socket.on('dealer:addCard', ({ target, card }) => {
    if (!card || !card.r || !card.s) return socket.emit('err', 'Неверная карта');
    const allowedR = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const allowedS = ['♠','♥','♦','♣'];
    if (!allowedR.includes(card.r) || !allowedS.includes(card.s)) return socket.emit('err', 'Неверная карта');
    if (target && target.type === 'dealer') { dealerAddCardToSelf(card); io.emit('dealerMsg', `Дилер: ${card.r}${card.s}`); return; }
    if (target && target.type === 'seat' && Number.isInteger(target.idx)) {
      dealerAddCardToSeat(target.idx, card);
      const s = table.seats[target.idx];
      if (s) io.emit('dealerMsg', `${s.name}: ${card.r}${card.s}`);
      if (s && s.doubled && s.cards.length >= 3 && !s.busted) { s.stood = true; broadcastState(); }
      return;
    }
  });
  socket.on('dealer:reveal', () => dealerRevealCard());
  socket.on('dealer:finish', async () => { if (table.phase === 'payout') return; await dealerFinishRound(); });
  socket.on('dealer:resetRound', () => {
    clearTableTimer(); table.phase = 'waiting'; table.dealerCards = []; table.dealerHidden = true;
    for (const s of table.seats) if (s) { s.cards = []; s.stood = false; s.busted = false; s.doubled = false; s.result = null; s.bet = 0; s.wantsCard = false; }
    broadcastState(); io.emit('dealerMsg', 'Раунд сброшен');
  });
  socket.on('disconnect', () => {
    const seat = socket.data.seat;
    if (seat != null && table.seats[seat] && table.seats[seat].socketId === socket.id) {
      if (['waiting','betting'].includes(table.phase)) table.seats[seat] = null;
      else { table.seats[seat].stood = true; table.seats[seat].wantsCard = false; }
      broadcastState();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Сервер запущен на порту ' + PORT);
  console.log('  Админ:   /admin.html');
  console.log('  Профиль: /profile.html');
  console.log('  Crash:   /crash.html');
  console.log('  Cases:   /cases.html');
  console.log('  Miner:   /miner.html');
  console.log('  Ladder:  /ladder.html');
  console.log('  Roulette: /roulette.html (страницы нет — дилер вбивает через admin.html)');
  console.log('  Tournament: /tournament.html');
  console.log('');
});
