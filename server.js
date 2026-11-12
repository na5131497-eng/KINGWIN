\const http = require('http');
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
  Bronze: { min: 0, gift: 0 }, Silver: { min: 100, gift: 0 },
  Gold: { min: 300, gift: 0 }, Platinum: { min: 600, gift: 0 },
  Diamond: { min: 1000, gift: 0 }, VIP: { min: 1500, gift: 0 }
};
const RANK_ORDER = ['Bronze','Silver','Gold','Platinum','Diamond','VIP'];
const RANK_INDEX = { 'Bronze': 1, 'Silver': 2, 'Gold': 3, 'Platinum': 4, 'Diamond': 5, 'VIP': 6 };

function rankByPoints(p){
  if (p >= RANKS.VIP.min) return 'VIP';
  if (p >= RANKS.Diamond.min) return 'Diamond';
  if (p >= RANKS.Platinum.min) return 'Platinum';
  if (p >= RANKS.Gold.min) return 'Gold';
  if (p >= RANKS.Silver.min) return 'Silver';
  return 'Bronze';
}

const DEALER_RANKS = [
  { key: 'Trainee', label: 'Стажёр', min: 0, percent: 10, bonus: 0, color: '#cd7f32' },
  { key: 'Dealer', label: 'Дилер', min: 200, percent: 11, bonus: 0, color: '#c0c0c0' },
  { key: 'Senior', label: 'Ст. дилер', min: 600, percent: 12, bonus: 100, color: '#f1c40f' },
  { key: 'Master', label: 'Мастер', min: 1200, percent: 13, bonus: 200, color: '#e5e4e2' },
  { key: 'Elite', label: 'Элит', min: 2000, percent: 14, bonus: 300, color: '#b9f2ff' },
  { key: 'VIP', label: 'VIP', min: 3000, percent: 15, bonus: 500, color: '#ffe066' }
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
    { v:10, w:42000 }, { v:15, w:24000 }, { v:25, w:13000 },
    { v:50, w:8500 }, { v:100, w:5500 }, { v:115, w:3200 },
    { v:200, w:1800 }, { v:250, w:900 }, { v:500, w:500 },
    { v:650, w:300 }, { v:1000, w:50 }
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
  low: [2.4, 1.5, 1.1, 0.9, 0.6, 0.9, 1.1, 1.5, 2.4],
  medium: [7.0, 2.2, 1.0, 0.5, 0.25, 0.5, 1.0, 2.2, 7.0],
  high: [15.0, 3.5, 0.8, 0.25, 0.1, 0.25, 0.8, 3.5, 15.0]
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
const CRASH_MAX_MULT = 100;

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
    // === HEALTH ===
    if (url === '/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
    }

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

    // === LIVEKIT ===
    if (url === '/api/livekit/token' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const identity = String(u.searchParams.get('identity') || '').trim();
      const role = String(u.searchParams.get('role') || 'player');
      if (!identity) return sendJSON(res, 400, { error: 'no identity' });
      if (!['dealer','player'].includes(role)) return sendJSON(res, 400, { error: 'bad role' });
      try { const token = await makeLivekitToken(identity, role); return sendJSON(res, 200, { token, url: LIVEKIT_URL }); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/jackpot' && method === 'GET') { const jackpot = await getActualJackpot(); return sendJSON(res, 200, { jackpot }); }

    // === HOUSE STATS ===
    if (url === '/api/admin/house/stats' && method === 'GET') {
      const all = await getCasinoStats('all');
      const today = await getCasinoStats('today');
      const h = await getHouseRTP();
      const t = await getTreasury();
      return sendJSON(res, 200, {
        all, today,
        treasury: t.treasury,
        income_total: t.income,
        expense_total: t.expense,
        actualRTP_today: h.actualRTP,
        targetRTP: h.rtp,
        targetRTP_pct: Math.round(h.rtp * 100),
        houseEdge_pct: Math.round((1 - h.rtp) * 100),
        mode: h.mode,
        label: h.mode === 'drain' ? 'жёсткий' : h.mode === 'catchup' ? 'догоняем' : 'базовый'
      });
    }

    if (url === '/api/admin/treasury/breakdown' && method === 'GET') {
      const t = await getTreasury();
      const today = await getCasinoStats('today');
      const h = await getHouseRTP();
      const turnover = today.turnover || 0;
      const paid = today.expense || 0;
      const houseCut = today.income || 0;
      return sendJSON(res, 200, {
        turnover_today: turnover, paid_today: paid, house_cut_today: houseCut,
        actual_rtp_today: turnover > 0 ? paid / turnover : 0,
        target_rtp: h.rtp, treasury_all_time: t.treasury,
        income_all_time: t.income, expense_all_time: t.expense, mode: h.mode
      });
    }

    // === ADMIN: ОЧИСТКА ===
    if (url === '/api/admin/clear-all' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      try {
        await pool.query('DELETE FROM sessions');
        await pool.query('DELETE FROM baccarat');
        await pool.query('DELETE FROM deposits');
        await pool.query('DELETE FROM withdrawals');
        await pool.query('DELETE FROM payouts');
        await pool.query('DELETE FROM online');
        await pool.query('DELETE FROM audit');
        await pool.query('DELETE FROM guests');
        await pool.query('DELETE FROM crash_bets');
        await pool.query('DELETE FROM crash_rounds');
        await pool.query('DELETE FROM cases_log');
        await pool.query('DELETE FROM game_history');
        await pool.query('DELETE FROM dealer_reviews');
        await pool.query('DELETE FROM news');
        await pool.query('DELETE FROM promo_uses');
        await pool.query('DELETE FROM promo_codes');
        await pool.query('DELETE FROM cash_safe');
        await pool.query('DELETE FROM dealer_tasks');
        await pool.query('DELETE FROM dealer_daily');
        await pool.query('DELETE FROM dealer_balance');
        await pool.query('DELETE FROM dealer_withdrawals');
        await pool.query('DELETE FROM miner_force_lose_players');
        await pool.query('DELETE FROM roulette_sessions');
        await pool.query('DELETE FROM tournament_entries');
        await pool.query('DELETE FROM tournament_bets');
        await pool.query('DELETE FROM tournaments');
        queuedBets = [];
        Object.keys(ladderSessions).forEach(k => delete ladderSessions[k]);
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ГОСТИ: БАЛАНС (АДМИН) ===
    if (url === '/api/admin/guests/balance' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      const id = String(b.id || '').trim();
      const amount = parseFloat(b.amount) || 0;
      const type = String(b.type || 'deposit');
      const op = String(b.op || 'add');
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      if (amount <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть > 0' });
      if (!['deposit','bonus'].includes(type)) return sendJSON(res, 400, { error: 'bad type' });
      if (!['add','sub'].includes(op)) return sendJSON(res, 400, { error: 'bad op' });
      const gRes = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Гость не найден' });
      const g = gRes.rows[0];
      const col = type === 'bonus' ? 'bonus_balance' : 'deposit_balance';
      const cur = parseFloat(g[col]) || 0;
      let next;
      if (op === 'add') next = cur + amount;
      else { next = cur - amount; if (next < 0) return sendJSON(res, 400, { error: `Недостаточно средств. Доступно: ${cur.toFixed(2)} ₽` }); }
      await pool.query(`UPDATE guests SET ${col}=$1 WHERE id=$2`, [next, id]);
      if (type === 'deposit') {
        try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), op === 'add' ? 'расход' : 'доход', amount, `Admin ${op} deposit ${g.name} (#${id})`]); } catch(e) {}
      }
      const bal = await getBalance(id);
      return sendJSON(res, 200, { ok: true, balance: bal });
    }

    // === CRASH: ADMIN ===
    if (url === '/api/admin/crash/force-next' && method === 'GET') {
      try { const r = await pool.query(`SELECT value FROM settings WHERE key='crash_force_next'`); const val = r.rows.length ? parseFloat(r.rows[0].value) || 0 : 0; return sendJSON(res, 200, { value: val }); }
      catch(e) { return sendJSON(res, 200, { value: 0 }); }
    }
    if (url === '/api/admin/crash/force-next' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      const val = parseFloat(b.value);
      if (!isFinite(val) || val < 1.0 || val > 100) return sendJSON(res, 400, { error: 'Коэффициент должен быть от 1.00 до 100' });
      await pool.query(`INSERT INTO settings (key, value) VALUES ('crash_force_next', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [String(val)]);
      return sendJSON(res, 200, { ok: true, value: val });
    }
    if (url === '/api/admin/crash/clear-force' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      await pool.query(`UPDATE settings SET value='' WHERE key='crash_force_next'`);
      return sendJSON(res, 200, { ok: true });
    }
    if (url === '/api/admin/crash/live' && method === 'GET') {
      let multiplier = 1;
      if (crashState.status === 'flying' && crashState.startTime) {
        const elapsed = Date.now() - crashState.startTime;
        multiplier = Math.pow(1.00006, elapsed);
        if (multiplier > crashState.crashPoint) multiplier = crashState.crashPoint;
      } else if (crashState.status === 'crashed') { multiplier = crashState.crashPoint; }
      const msToPlanned = crashState.status === 'flying' ? Math.max(0, (Math.log(crashState.crashPoint) / Math.log(1.00006)) - (Date.now() - crashState.startTime)) : 0;
      return sendJSON(res, 200, { status: crashState.status, multiplier: Math.round(multiplier * 100) / 100, crashPoint: crashState.crashPoint, plannedCrashPoint: crashState.plannedCrashPoint, msToPlanned, roundId: crashState.roundId });
    }
    if (url === '/api/admin/crash/stop' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      if (crashState.status !== 'flying') return sendJSON(res, 400, { error: 'Раунд не в полёте' });
      crashClearTimers();
      crashState.crashPoint = Math.pow(1.00006, Date.now() - crashState.startTime);
      crashState.forcedStop = true;
      await crashEndRound();
      return sendJSON(res, 200, { ok: true, stopped_at: Math.round(crashState.crashPoint * 100) / 100 });
    }

    // === MINER: ADMIN ===
    if (url === '/api/admin/miner/force-lose' && method === 'GET') {
      try { const r = await pool.query(`SELECT value FROM settings WHERE key='miner_force_lose'`); const enabled = r.rows.length && String(r.rows[0].value) === '1'; return sendJSON(res, 200, { enabled }); }
      catch (e) { return sendJSON(res, 200, { enabled: false }); }
    }
    if (url === '/api/admin/miner/force-lose' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      const enabled = b.enabled === true || b.enabled === '1';
      await pool.query(`INSERT INTO settings (key, value) VALUES ('miner_force_lose', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [enabled ? '1' : '0']);
      return sendJSON(res, 200, { ok: true, enabled });
    }
    if (url === '/api/admin/miner/history' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(500, parseInt(u.searchParams.get('limit'), 10) || 100);
      try {
        const r = await pool.query(`SELECT id, player_name, bet, result, mines, revealed, multiplier, status, created_at FROM game_history WHERE game = 'miner' ORDER BY id DESC LIMIT $1`, [limit]);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/admin/miner/active' && method === 'GET') {
      const now = Date.now();
      const list = Object.keys(minerSessions).map(sid => {
        const s = minerSessions[sid];
        return { session_id: sid, guest_id: s.guestId, bet: s.bet, mines: s.mines.length, revealed: s.revealed.length, started_at: new Date(s.createdAt).toISOString(), elapsed_sec: Math.round((now - s.createdAt) / 1000) };
      });
      return sendJSON(res, 200, list);
    }
    if (url === '/api/admin/miner/players' && method === 'GET') {
      try {
        const r = await pool.query(`
          SELECT DISTINCT COALESCE(gh.guest_id, gh.player_name) AS guest_id, gh.player_name AS guest_name, MAX(gh.created_at) AS last_played
          FROM game_history gh WHERE gh.game = 'miner'
          GROUP BY COALESCE(gh.guest_id, gh.player_name), gh.player_name
        `);
        const forced = await pool.query(`SELECT guest_id FROM miner_force_lose_players`);
        const forcedSet = new Set(forced.rows.map(x => String(x.guest_id)));
        const list = r.rows.map(row => ({ guest_id: String(row.guest_id), guest_name: row.guest_name || '', last_played: row.last_played, forced: forcedSet.has(String(row.guest_id)) }));
        for (const f of forced.rows) {
          if (!list.find(x => x.guest_id === String(f.guest_id))) list.push({ guest_id: String(f.guest_id), guest_name: '', last_played: null, forced: true });
        }
        list.sort((a, b) => new Date(b.last_played || 0) - new Date(a.last_played || 0));
        return sendJSON(res, 200, list);
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/admin/miner/player-force' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль owner' });
      const guestId = String(b.guest_id || '').trim();
      const guestName = String(b.guest_name || '').trim();
      const enabled = b.enabled === true || b.enabled === '1';
      if (!guestId) return sendJSON(res, 400, { error: 'no guest_id' });
      try {
        if (enabled) await pool.query(`INSERT INTO miner_force_lose_players (guest_id, guest_name) VALUES ($1,$2) ON CONFLICT (guest_id) DO UPDATE SET guest_name=$2, updated_at=NOW()`, [guestId, guestName]);
        else await pool.query(`DELETE FROM miner_force_lose_players WHERE guest_id=$1`, [guestId]);
        return sendJSON(res, 200, { ok: true, guest_id: guestId, enabled });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ПРОФИЛЬ ГОСТЯ ===
    if (url === '/api/guest/summary' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
        if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
        const g = r.rows[0];
        const wagerReq = parseFloat(g.wagering_required) || 0;
        const wagerDone = parseFloat(g.wagering_done) || 0;
        return sendJSON(res, 200, {
          id: g.id, name: g.name, rank: g.rank, points: g.points || 0,
          deposit_balance: parseFloat(g.deposit_balance) || 0,
          bonus_balance: parseFloat(g.bonus_balance) || 0,
          wagering_required: wagerReq, wagering_done: wagerDone,
          pending_bonus: parseFloat(g.pending_bonus) || 0,
          next_min: { Bronze: 100, Silver: 300, Gold: 600, Platinum: 1000, Diamond: 1500, VIP: null }[g.rank] || 100
        });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/guest/daily' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query('SELECT daily_level, daily_last_claim, pending_bonus FROM guests WHERE id=$1', [id]);
        if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
        const g = r.rows[0];
        const today = todayStr();
        const lastClaim = g.daily_last_claim ? dateStr(g.daily_last_claim) : null;
        const claimed = lastClaim === today;
        return sendJSON(res, 200, { level: g.daily_level || 0, claimed_today: claimed, pending_bonus: parseFloat(g.pending_bonus) || 0 });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/guest/daily-claim' && method === 'POST') {
      const b = await parseBody(req);
      const id = String(b.id || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
        if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
        const g = r.rows[0];
        const today = todayStr();
        const lastClaim = g.daily_last_claim ? dateStr(g.daily_last_claim) : null;
        if (lastClaim === today) return sendJSON(res, 400, { error: 'Бонус уже получен сегодня' });
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const yesterday = yest.toISOString().slice(0, 10);
        let level = (g.daily_level || 0);
        if (lastClaim !== yesterday) level = 0;
        level = Math.min(7, level + 1);
        const reward = DAILY_REWARDS[level - 1] || 10;
        await pool.query('UPDATE guests SET daily_level=$1, daily_last_claim=$2, pending_bonus=pending_bonus+$3 WHERE id=$4', [level, today, reward, id]);
        return sendJSON(res, 200, { ok: true, level, reward, pending_bonus: (parseFloat(g.pending_bonus) || 0) + reward });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/guest/withdraw-to-casino' && method === 'POST') {
      const b = await parseBody(req);
      const id = String(b.id || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query('SELECT pending_bonus, bonus_balance, wagering_required, wagering_done FROM guests WHERE id=$1', [id]);
        if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
        const g = r.rows[0];
        const pending = parseFloat(g.pending_bonus) || 0;
        if (pending <= 0) return sendJSON(res, 400, { error: 'Нет бонусов для перевода' });
        const wagerReq = parseFloat(g.wagering_required) || 0;
        const wagerDone = parseFloat(g.wagering_done) || 0;
        if (wagerReq > 0 && wagerDone < wagerReq) return sendJSON(res, 400, { error: `Отыграйте бонус: ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽` });
        await pool.query('UPDATE guests SET bonus_balance = bonus_balance + pending_bonus, pending_bonus = 0 WHERE id=$1', [id]);
        return sendJSON(res, 200, { ok: true, amount: pending });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/guest/change-password' && method === 'POST') {
      const b = await parseBody(req);
      const id = String(b.id || '').trim();
      const oldPass = String(b.old_pass || '');
      const newPass = String(b.new_pass || '');
      if (!id || !oldPass || !newPass) return sendJSON(res, 400, { error: 'no data' });
      if (newPass.length < 4) return sendJSON(res, 400, { error: 'Пароль слишком короткий' });
      try {
        const r = await pool.query('SELECT pass FROM guests WHERE id=$1', [id]);
        if (!r.rows.length) return sendJSON(res, 404, { error: 'not found' });
        if (String(r.rows[0].pass) !== oldPass) return sendJSON(res, 400, { error: 'Неверный текущий пароль' });
        await pool.query('UPDATE guests SET pass=$1 WHERE id=$2', [newPass, id]);
        return sendJSON(res, 200, { ok: true });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === НОВОСТИ / ОТЗЫВЫ ===
    if (url === '/api/news' && method === 'GET') {
      try { const r = await pool.query('SELECT * FROM news ORDER BY id DESC LIMIT 20'); return sendJSON(res, 200, r.rows); }
      catch(e) { return sendJSON(res, 200, []); }
    }
    if (url === '/api/dealer/exists' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const name = u.searchParams.get('name');
      if (!name) return sendJSON(res, 400, { error: 'no name' });
      try {
        const r = await pool.query('SELECT 1 FROM dealers WHERE LOWER(name) = LOWER($1)', [name]);
        return sendJSON(res, 200, { exists: r.rows.length > 0 });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer-reviews' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guest_id = u.searchParams.get('guest_id');
      try {
        let q = 'SELECT * FROM dealer_reviews';
        let p = [];
        if (guest_id) { q += ' WHERE guest_id=$1'; p.push(guest_id); }
        q += ' ORDER BY id DESC LIMIT 50';
        const r = await pool.query(q, p);
        return sendJSON(res, 200, r.rows);
      } catch(e) { return sendJSON(res, 200, []); }
    }
    if (url === '/api/dealer-reviews' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const guestName = String(b.guest_name || '').trim();
      const dealerName = String(b.dealer_name || '').trim();
      const stars = parseInt(b.stars, 10) || 0;
      const comment = String(b.comment || '').trim();
      if (!guestId || !dealerName || stars < 1) return sendJSON(res, 400, { error: 'bad data' });
      try {
        await pool.query('INSERT INTO dealer_reviews (date, guest_id, guest_name, dealer_name, stars, comment) VALUES ($1,$2,$3,$4,$5,$6)', [todayStr(), guestId, guestName, dealerName, stars, comment]);
        return sendJSON(res, 200, { ok: true });
      } catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === EMPIRE OF GOLD ===
    if (url === '/api/slots/empire/spin' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите в аккаунт' });
      if (bet < 6) return sendJSON(res, 400, { error: 'Мин. ставка 6 ₽' });
      if (bet > 120) return sendJSON(res, 400, { error: 'Макс. ставка 120 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const isBonusGame = debited.fromBonus > 0 && debited.fromDeposit === 0;
      const house = await getHouseRTP();
      const targetRTP = house.rtp;
      let winAmount = 0;
      const winChance = 0.35 + (targetRTP - 0.80) * 1.5;
      if (Math.random() < winChance) {
        const multipliers = [0.2, 0.3, 0.5, 1, 2, 5];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
        winAmount = bet * mult;
        if (winAmount > MAX_WIN_SLOT) winAmount = MAX_WIN_SLOT;
        winAmount = Math.round(winAmount * 100) / 100;
      }
      if (winAmount > 0) await creditWin(guestId, winAmount, bet);
      try {
        await pool.query(`INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          ['empire_of_gold', guestId, bet, winAmount, winAmount > 0 ? (winAmount / bet) : 0, winAmount > 0 ? 'win' : 'lose', guestId]);
        if (!isBonusGame) {
          const net = bet - winAmount;
          await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
            [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Slot Empire (${guestId})`]);
        }
      } catch(e) {}
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, win: winAmount, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, treasury: house.treasury, rtp: targetRTP });
    }

    // === PLINKO ===
    if (url === '/api/plinko/drop' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
      const risk = String(b.risk || 'low');
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите в аккаунт' });
      if (!PLINKO_MULTIPLIERS[risk]) return sendJSON(res, 400, { error: 'Неверный риск' });
      if (bet < 1) return sendJSON(res, 400, { error: 'Мин. ставка 1 ₽' });
      if (bet > 100) return sendJSON(res, 400, { error: 'Макс. ставка 100 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const isBonusGame = debited.fromBonus > 0 && debited.fromDeposit === 0;
      const path = [];
      for (let i = 0; i < PLINKO_ROWS; i++) path.push(Math.random() < 0.5 ? 0 : 1);
      let slot = path.reduce((a, x) => a + x, 0);
      const h = await getHouseRTP();
      const targetRTP = await getTargetRTP(guestId);
      const edge = Math.max(0, (0.80 - targetRTP) / 0.80);
      const cheatProb = edge * (h.mode === 'drain' ? 1.0 : h.mode === 'base' ? 0.5 : 0.2);
      if (cheatProb > 0 && Math.random() < cheatProb) {
        const center = 4;
        const shift = (slot > center ? -1 : 1) * (Math.random() < 0.6 ? 1 : 2);
        const newSlot = Math.max(0, Math.min(8, slot + shift));
        path.length = 0;
        const ones = newSlot, zeros = PLINKO_ROWS - newSlot;
        const arr = [...Array(ones).fill(1), ...Array(zeros).fill(0)];
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        path.push(...arr);
        slot = newSlot;
      }
      const multiplier = PLINKO_MULTIPLIERS[risk][slot];
      const winAmount = Math.round(bet * multiplier * 100) / 100;
      if (winAmount > 0) await creditWin(guestId, winAmount, bet);
      try {
        await pool.query(`INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          ['plinko', guestId, bet, winAmount, multiplier, winAmount > bet ? 'win' : (winAmount === bet ? 'push' : 'lose'), guestId]);
        if (!isBonusGame) {
          const net = bet - winAmount;
          await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`,
            [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Plinko ${risk} (${guestId})`]);
        }
      } catch(e) {}
      try { const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]); if (gName.rows.length) await accruePointsByNick(gName.rows[0].name, bet, 'plinko'); } catch(e) {}
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, path, slot, multiplier, win: winAmount, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering, treasury: h.treasury, house_mode: h.mode });
    }

    // === LADDER ===
    if (url === '/api/ladder/start' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = parseFloat(b.bet) || 0;
      const minesCount = parseInt(b.mines, 10) || 1;
      if (!guestId) return sendJSON(res, 400, { error: 'no guest_id' });
      if (bet < 10) return sendJSON(res, 400, { error: 'Мин. ставка 10 ₽' });
      if (bet > 1000) return sendJSON(res, 400, { error: 'Макс. ставка 1000 ₽' });
      if (minesCount < 1 || minesCount > 7) return sendJSON(res, 400, { error: 'Камней от 1 до 7' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const levelsCount = 13;
      const cellsCount = 20;
      const ladder = [];
      for (let i = 0; i < levelsCount; i++) {
        const mines = [];
        while (mines.length < minesCount) { const r = Math.floor(Math.random() * cellsCount); if (!mines.includes(r)) mines.push(r); }
        ladder.push({ cellsCount, mines, cheated: false });
      }
      const sessionId = 'lad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      ladderSessions[sessionId] = { guestId, bet, minesCount, ladder, currentStep: 0, finished: false, createdAt: Date.now(), debitResult: debited };
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, session_id: sessionId, ladder: ladder.map(l => ({ cellsCount: l.cellsCount, mines: l.mines })), bet, mines: minesCount, levels: levelsCount, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
    }
    if (url === '/api/ladder/step' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const sessionId = String(b.session_id || '').trim();
      const cellIdx = parseInt(b.cell, 10);
      if (!sessionId || !ladderSessions[sessionId]) return sendJSON(res, 404, { error: 'Сессия не найдена' });
      const sess = ladderSessions[sessionId];
      if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая сессия' });
      if (sess.finished) return sendJSON(res, 400, { error: 'Сессия завершена' });
      if (sess.currentStep >= 13) return sendJSON(res, 400, { error: 'Игра уже завершена' });
      if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= 20) return sendJSON(res, 400, { error: 'Неверная клетка' });
      const currentLevel = sess.ladder[sess.currentStep];
      const isBonusGame = sess.debitResult && sess.debitResult.fromBonus > 0 && sess.debitResult.fromDeposit === 0;
      if (currentLevel.mines.includes(cellIdx)) {
        sess.finished = true;
        try {
          if (!isBonusGame) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', sess.bet, `Ladder LOSS (${guestId})`]);
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1,$2,$3,$4,NOW(),$5)`, ['ladder', guestId, sess.bet, 0, guestId]);
        } catch(e){}
        const bal = await getBalance(guestId);
        return sendJSON(res, 200, { ok: true, result: 'lose', correct_cells: currentLevel.mines, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
      }
      let isMine = false;
      if (!currentLevel.cheated) {
        const targetRTP = await getTargetRTP(guestId);
        const cheatChance = Math.max(0, (0.99 - targetRTP) / 0.99);
        const effectiveCheat = cheatChance * 0.25;
        if (Math.random() < effectiveCheat) { isMine = true; currentLevel.mines.push(cellIdx); currentLevel.cheated = true; }
      }
      if (isMine) {
        sess.finished = true;
        try {
          if (!isBonusGame) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', sess.bet, `Ladder LOSS (${guestId})`]);
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1,$2,$3,$4,NOW(),$5)`, ['ladder', guestId, sess.bet, 0, guestId]);
        } catch(e){}
        const bal = await getBalance(guestId);
        return sendJSON(res, 200, { ok: true, result: 'lose', correct_cells: currentLevel.mines, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
      }
      sess.currentStep++;
      if (sess.currentStep >= 13) {
        sess.finished = true;
        const mults = LADDER_MULTS[sess.minesCount];
        const winMult = mults[12];
        const winAmount = Math.round(sess.bet * winMult * 100) / 100;
        await creditWin(guestId, winAmount, sess.bet);
        try {
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1,$2,$3,$4,NOW(),$5)`, ['ladder', guestId, sess.bet, winMult, guestId]);
          if (!isBonusGame) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', winAmount, `Ladder WIN (${guestId})`]);
        } catch(e){}
        const bal = await getBalance(guestId);
        return sendJSON(res, 200, { ok: true, result: 'win', win: winAmount, mult: winMult, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
      }
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, result: 'safe', next_step: sess.currentStep, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
    }
    if (url === '/api/ladder/cashout' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const sessionId = String(b.session_id || '').trim();
      if (!sessionId || !ladderSessions[sessionId]) return sendJSON(res, 404, { error: 'Сессия не найдена' });
      const sess = ladderSessions[sessionId];
      if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая сессия' });
      if (sess.finished) return sendJSON(res, 400, { error: 'Сессия уже завершена' });
      if (sess.currentStep === 0) return sendJSON(res, 400, { error: 'Нет пройденных уровней' });
      const mults = LADDER_MULTS[sess.minesCount];
      const winMult = mults[sess.currentStep - 1];
      const winAmount = Math.round(sess.bet * winMult * 100) / 100;
      sess.finished = true;
      await creditWin(guestId, winAmount, sess.bet);
      const isBonusGame = sess.debitResult && sess.debitResult.fromBonus > 0 && sess.debitResult.fromDeposit === 0;
      try {
        await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1,$2,$3,$4,NOW(),$5)`, ['ladder', guestId, sess.bet, winMult, guestId]);
        if (!isBonusGame) await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', winAmount, `Ladder CASHOUT (${guestId})`]);
      } catch(e){}
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, result: 'cashout', win: winAmount, mult: winMult, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    // === CASES ===
    if (url === '/api/cases/last-drops' && method === 'GET') {
      try { const r = await pool.query(`SELECT guest_name, case_name, prize, created_at FROM cases_log WHERE prize > 0 ORDER BY id DESC LIMIT 20`); return sendJSON(res, 200, r.rows); }
      catch (e) { return sendJSON(res, 200, []); }
    }
    if (url === '/api/cases/list' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guestId = u.searchParams.get('guest_id');
      let rankIdx = 0;
      if (guestId) { const g = await pool.query('SELECT rank FROM guests WHERE id=$1', [guestId]); if (g.rows.length) rankIdx = RANK_INDEX[g.rows[0].rank] || 0; }
      const list = Object.entries(CASES).map(([name, c]) => ({ name, price: c.price, minRank: c.minRank, available: rankIdx >= c.minRank, prizes: c.prizes.map(p => p.v) }));
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
      if (rankIdx < c.minRank) return sendJSON(res, 403, { error: 'Кейс недоступен' });
      const debited = await debitBet(guest.id, c.price);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const isBonusGame = debited.fromBonus > 0 && debited.fromDeposit === 0;
      const targetRTP = await getTargetRTP(guest.id);
      const ratio = targetRTP / 0.99;
      const adjustedPrizes = c.prizes.map(p => {
        const prizeRatio = p.v / c.price;
        let weight = p.w;
        if (ratio < 1) {
          if (prizeRatio < 1) weight *= (1 + (1 - ratio) * 1.5);
          else if (prizeRatio < 3) weight *= (1 - (1 - ratio) * 0.5);
          else weight *= Math.max(0.05, ratio * ratio);
        } else if (ratio > 1) {
          if (prizeRatio > 3) weight *= (1 + (ratio - 1) * 2);
        }
        return { ...p, w: Math.max(1, Math.round(weight)) };
      });
      const prize = pickPrize(adjustedPrizes);
      await creditWin(guest.id, prize, c.price);
      await pool.query(`INSERT INTO cases_log (date, guest_id, guest_name, case_name, case_price, prize) VALUES ($1,$2,$3,$4,$5,$6)`, [todayStr(), guest.id, guest.name, case_name, c.price, prize]);
      await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1, $2, $3, $4, NOW(), $5)`, ['cases', guest.name, c.price, prize, guest.id]);
      if (!isBonusGame) {
        const net = c.price - prize;
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Case ${case_name} (${guest.name})`]);
      }
      const bal = await getBalance(guest.id);
      return sendJSON(res, 200, { ok: true, prize, new_balance: bal.total, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, case_name, price: c.price, wagering: bal.wagering });
    }
    if (url === '/api/cases/history' && method === 'GET') {
      try { const r = await pool.query(`SELECT player_name as name, bet, result, created_at FROM game_history WHERE game='cases' ORDER BY id DESC LIMIT 15`); return sendJSON(res, 200, r.rows); }
      catch(e) { return sendJSON(res, 200, []); }
    }

    // === MINER ===
    if (url === '/api/miner/start' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = parseFloat(b.bet) || 0;
      let mines = parseInt(b.mines, 10) || 3;
      if (mines < 1) mines = 1;
      if (mines > 24) mines = 24;
      if (!guestId) return sendJSON(res, 400, { error: 'no guest_id' });
      if (bet < 5) return sendJSON(res, 400, { error: 'Мин. ставка 5 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const TOTAL = 25;
      const mineSet = new Set();
      while (mineSet.size < mines) mineSet.add(Math.floor(Math.random() * TOTAL));
      const sessionId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      minerSessions[sessionId] = { guestId, bet, mines: [...mineSet], revealed: [], createdAt: Date.now(), debitResult: debited };
      for (const sid in minerSessions) { if (Date.now() - minerSessions[sid].createdAt > 3600000) delete minerSessions[sid]; }
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, session_id: sessionId, bet, size: 5, mines, revealed: [], multiplier: 1.0, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
    }
    if (url === '/api/miner/open' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const sessionId = String(b.session_id || '').trim();
      const cell = parseInt(b.cell, 10);
      const sess = minerSessions[sessionId];
      if (!sess) return sendJSON(res, 404, { error: 'Сессия не найдена' });
      if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая сессия' });
      if (!Number.isInteger(cell) || cell < 0 || cell >= 25) return sendJSON(res, 400, { error: 'Неверная клетка' });
      if (sess.revealed.includes(cell)) return sendJSON(res, 400, { error: 'Уже открыта' });
      if (sess.finished) return sendJSON(res, 400, { error: 'Сессия завершена' });
      let forceLose = false;
      try { const fp = await pool.query(`SELECT 1 FROM miner_force_lose_players WHERE guest_id=$1`, [guestId]); if (fp.rows.length > 0) forceLose = true; } catch(e) {}
      if (!forceLose) { try { const fr = await pool.query(`SELECT value FROM settings WHERE key='miner_force_lose'`); forceLose = (fr.rows.length && String(fr.rows[0].value) === '1'); } catch(e) {} }
      const isBonusGame = sess.debitResult && sess.debitResult.fromBonus > 0 && sess.debitResult.fromDeposit === 0;
      if (forceLose) {
        sess.finished = true;
        const forcedMines = [cell];
        try {
          await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', isBonusGame ? 0 : sess.bet, `Miner LOSS (forced)${isBonusGame ? ' (bonus)' : ''} (${guestId})`]);
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, 0, forcedMines.length, sess.revealed.length + 1, 0, 'lose', guestId]);
        } catch(e) {}
        try { const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]); if (gName.rows.length) await accruePointsByNick(gName.rows[0].name, sess.bet, 'miner'); } catch(e) {}
        const bal = await getBalance(guestId);
        const result = { ok: true, mine: true, cell, mines: forcedMines, session_id: sessionId, forced: true, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus };
        delete minerSessions[sessionId];
        return sendJSON(res, 200, result);
      }
      let isMine = sess.mines.includes(cell);
      if (!isMine) {
        const targetRTP = await getTargetRTP(guestId);
        const cheatChance = Math.max(0, (0.99 - targetRTP) / 0.99);
        const effectiveCheat = cheatChance * 0.35;
        if (Math.random() < effectiveCheat) { isMine = true; sess.mines.push(cell); }
      }
      if (isMine) {
        sess.finished = true;
        try {
          await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', isBonusGame ? 0 : sess.bet, `Miner LOSS${isBonusGame ? ' (bonus)' : ''} (${guestId})`]);
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, 0, sess.mines.length, sess.revealed.length, 0, 'lose', guestId]);
        } catch(e) {}
        try { const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]); if (gName.rows.length) await accruePointsByNick(gName.rows[0].name, sess.bet, 'miner'); } catch(e) {}
        const bal = await getBalance(guestId);
        const result = { ok: true, mine: true, cell, mines: sess.mines, session_id: sessionId, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus };
        delete minerSessions[sessionId];
        return sendJSON(res, 200, result);
      }
      sess.revealed.push(cell);
      const safeOpened = sess.revealed.length;
      const safeTotal = 25 - sess.mines.length;
      let surviveProb = 1;
      for (let i = 0; i < safeOpened; i++) { surviveProb *= (safeTotal - i) / (25 - i); }
      const multiplier = Math.round((1 / surviveProb) * 100) / 100;
      const result = { ok: true, mine: false, cell, revealed: sess.revealed, multiplier, bet: sess.bet, potential_win: Math.round(sess.bet * multiplier * 100) / 100 };
      if (sess.revealed.length >= safeTotal) {
        const winAmount = Math.round(sess.bet * multiplier * 100) / 100;
        sess.finished = true;
        await creditWin(guestId, winAmount, sess.bet);
        try {
          await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, winAmount, sess.mines.length, sess.revealed.length, multiplier, 'win', guestId]);
          if (!isBonusGame) { const net = sess.bet - winAmount; await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Miner WIN (${guestId})`]); }
        } catch(e) {}
        delete minerSessions[sessionId];
        const bal = await getBalance(guestId);
        result.auto_cashout = true;
        result.win = winAmount;
        result.mines = sess.mines;
        result.balance = bal.total;
        result.deposit_balance = bal.deposit;
        result.bonus_balance = bal.bonus;
        result.wagering = bal.wagering;
      } else {
        const bal = await getBalance(guestId);
        result.balance = bal.total;
        result.deposit_balance = bal.deposit;
        result.bonus_balance = bal.bonus;
      }
      return sendJSON(res, 200, result);
    }
    if (url === '/api/miner/cashout' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const sessionId = String(b.session_id || '').trim();
      const sess = minerSessions[sessionId];
      if (!sess) return sendJSON(res, 404, { error: 'Сессия не найдена' });
      if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая сессия' });
      if (sess.finished) return sendJSON(res, 400, { error: 'Сессия завершена' });
      if (sess.revealed.length === 0) return sendJSON(res, 400, { error: 'Откройте клетку' });
      const safeOpened = sess.revealed.length;
      const safeTotal = 25 - sess.mines.length;
      let surviveProb = 1;
      for (let i = 0; i < safeOpened; i++) { surviveProb *= (safeTotal - i) / (25 - i); }
      const multiplier = Math.round((1 / surviveProb) * 100) / 100;
      const winAmount = Math.round(sess.bet * multiplier * 100) / 100;
      sess.finished = true;
      await creditWin(guestId, winAmount, sess.bet);
      const isBonusGame = sess.debitResult && sess.debitResult.fromBonus > 0 && sess.debitResult.fromDeposit === 0;
      try {
        await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, winAmount, sess.mines.length, sess.revealed.length, multiplier, 'win', guestId]);
        if (!isBonusGame) { const net = sess.bet - winAmount; await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Miner WIN (${guestId})`]); }
      } catch(e) {}
      const bal = await getBalance(guestId);
      const result = { ok: true, win: winAmount, multiplier, bet: sess.bet, mines: sess.mines, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering };
      delete minerSessions[sessionId];
      return sendJSON(res, 200, result);
    }
    if (url === '/api/miner/history' && method === 'GET') {
      try { const r = await pool.query(`SELECT player_name as name, bet, result, created_at FROM game_history WHERE game='miner' ORDER BY id DESC LIMIT 15`); return sendJSON(res, 200, r.rows); }
      catch(e) { return sendJSON(res, 200, []); }
    }

    // === CRASH ===
    if (url === '/api/crash/current' && method === 'GET') {
      let multiplier = 1;
      if (crashState.status === 'flying' && crashState.startTime) { const elapsed = Date.now() - crashState.startTime; multiplier = Math.pow(1.00006, elapsed); if (multiplier >= crashState.crashPoint) multiplier = crashState.crashPoint; }
      else if (crashState.status === 'crashed') multiplier = crashState.crashPoint;
      let bets = [];
      if (crashState.roundId) { try { const betsRes = await pool.query(`SELECT id, player_id, player_name, player_rank, amount, cashout_mult, cashed_out FROM crash_bets WHERE round_id=$1 ORDER BY id ASC`, [crashState.roundId]); bets = betsRes.rows; } catch(e) {} }
      let history = [];
      try { const histRes = await pool.query(`SELECT crash_point FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT 15`); history = histRes.rows.map(r => parseFloat(r.crash_point)); } catch(e) {}
      return sendJSON(res, 200, { roundId: crashState.roundId, status: crashState.status, startTime: crashState.startTime, crashPoint: crashState.status === 'crashed' ? crashState.crashPoint : null, multiplier, bets, history, hasRealBet: crashState.hasRealBet, queuedCount: queuedBets.length });
    }
    if (url === '/api/crash/all-bets' && method === 'GET') {
      try { const r = await pool.query(`SELECT b.*, r.crash_point, r.start_time FROM crash_bets b JOIN crash_rounds r ON b.round_id = r.id ORDER BY b.id DESC LIMIT 200`); return sendJSON(res, 200, r.rows); }
      catch (e) { return sendJSON(res, 200, []); }
    }
    if (url === '/api/crash/clear' && method === 'DELETE') {
      try { await pool.query('DELETE FROM crash_bets'); await pool.query('DELETE FROM crash_rounds'); await pool.query("DELETE FROM online WHERE note LIKE 'Crash Round%'"); queuedBets = []; return sendJSON(res, 200, { ok: true }); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/crash/bet' && method === 'POST') {
      const b = await parseBody(req);
      const amt = parseFloat(b.amount) || 0;
      if (amt < 1) return sendJSON(res, 400, { error: 'Мин. ставка 1 ₽' });
      if (amt > 200) return sendJSON(res, 400, { error: 'Макс. ставка 200 ₽' });
      if (crashState.status !== 'waiting') {
        if (!b.player_id) return sendJSON(res, 400, { error: 'Войдите в аккаунт' });
        const bal = await getBalance(String(b.player_id));
        if (bal.total < amt) return sendJSON(res, 400, { error: 'Недостаточно средств' });
        queuedBets.push({ player_id: String(b.player_id), amount: amt, queued_at: Date.now() });
        return sendJSON(res, 200, { ok: true, queued: true, amount: amt, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
      }
      let maskName = '••••', playerRank = 'Bronze', isBonus = false;
      if (b.player_id) {
        const debited = await debitBet(String(b.player_id), amt);
        if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
        isBonus = debited.fromBonus > 0 && debited.fromDeposit === 0;
        const gRes = await pool.query(`SELECT id, rank FROM guests WHERE id=$1`, [String(b.player_id)]);
        if (gRes.rows.length > 0) { const s = String(gRes.rows[0].id); maskName = s.length <= 4 ? s : s.slice(0, 4) + '••••'; playerRank = gRes.rows[0].rank || 'Bronze'; }
      }
      const r = await pool.query(`INSERT INTO crash_bets (round_id, player_id, player_name, player_rank, amount, is_bonus) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [crashState.roundId, b.player_id || null, maskName, playerRank, amt, isBonus]);
      if (b.player_id) crashState.hasRealBet = true;
      tryStartFlightCountdown();
      if (b.player_id) { try { const gRes = await pool.query(`SELECT name FROM guests WHERE id=$1`, [String(b.player_id)]); if (gRes.rows.length > 0) await accruePointsByNick(gRes.rows[0].name, amt, 'crash'); } catch(e){} }
      const bal = b.player_id ? await getBalance(String(b.player_id)) : null;
      return sendJSON(res, 200, { ok: true, bet: r.rows[0], balance: bal ? bal.total : 0, deposit_balance: bal ? bal.deposit : 0, bonus_balance: bal ? bal.bonus : 0 });
    }
    if (url === '/api/crash/cashout' && method === 'POST') {
      const b = await parseBody(req);
      if (crashState.status !== 'flying') return sendJSON(res, 400, { error: 'Не в фазе полёта' });
      const elapsed = Date.now() - crashState.startTime;
      let mult = Math.pow(1.00006, elapsed);
      if (mult >= crashState.crashPoint) return sendJSON(res, 400, { error: 'Поздно — краш' });
      const betRes = await pool.query(`SELECT * FROM crash_bets WHERE id=$1 AND round_id=$2 AND cashed_out=false`, [b.bet_id, crashState.roundId]);
      if (!betRes.rows.length) return sendJSON(res, 400, { error: 'Ставка не найдена' });
      const bet = betRes.rows[0];
      const winAmount = (parseFloat(bet.amount) * mult);
      await pool.query(`UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2`, [mult, b.bet_id]);
      let bal = null;
      if (bet.player_id && !String(bet.player_id).startsWith('BOT')) {
        await creditWin(bet.player_id, winAmount, parseFloat(bet.amount) || 0);
        bal = await getBalance(bet.player_id);
      }
      return sendJSON(res, 200, { ok: true, mult, win: winAmount, balance: bal ? bal.total : 0, deposit_balance: bal ? bal.deposit : 0, bonus_balance: bal ? bal.bonus : 0, wagering: bal ? bal.wagering : { required: 0, done: 0, left: 0 } });
    }

    // === ГОСТИ / ПРОФИЛЬ ===
    if (url === '/api/guests' && method === 'GET') { const r = await pool.query('SELECT * FROM guests ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/guests' && method === 'POST') {
      const g = await parseBody(req);
      const cardId = g.id || Math.floor(10000000 + Math.random() * 90000000).toString();
      const r = await pool.query(`INSERT INTO guests (id, name, rank, points, visits, bonus_text, bonus_code, pass) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [cardId, g.name, g.rank || 'Bronze', g.points || 0, g.visits || 0, g.bonus_text || '', g.bonus_code || '', g.pass || '1234']);
      return sendJSON(res, 200, { ok: true, guest: r.rows[0] });
    }
    if (url === '/api/guests/delete' && method === 'POST') { const g = await parseBody(req); await pool.query('DELETE FROM guests WHERE id=$1', [g.id]); return sendJSON(res, 200, { ok: true }); }
    if (url === '/api/guests/update' && method === 'POST') {
      const g = await parseBody(req);
      if (!g.id) return sendJSON(res, 400, { error: 'no id' });
      try { await pool.query(`UPDATE guests SET name = $1, rank = $2, pass = $3, bonus_text = $4, bonus_code = $5, bonus_balance = $6 WHERE id = $7`, [g.name, g.rank, g.pass, g.bonus_text, g.bonus_code, g.bonus_balance || 0, g.id]); return sendJSON(res, 200, { ok: true }); }
      catch(e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/guests/withdraw-deduct' && method === 'POST') {
      const { id, sum } = await parseBody(req);
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      await pool.query('UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2', [parseFloat(sum) || 0, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if (url === '/api/guest/login' && method === 'POST') {
      const { id, pass } = await parseBody(req);
      if (!id || !pass) return sendJSON(res, 400, { error: 'Введите номер карты и пароль' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id).trim()]);
      if (r.rows.length === 0) return sendJSON(res, 401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      const realPass = g.pass || '1234';
      if (String(pass) !== String(realPass)) return sendJSON(res, 401, { error: 'Неверный пароль' });
      try { await pool.query('UPDATE guests SET visits = visits + 1, last_visit = NOW() WHERE id=$1', [g.id]); } catch(e){}
      return sendJSON(res, 200, { ok: true, guest: g });
    }
    if (url === '/api/guest/me' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (r.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const guest = r.rows[0];
      let unseen = [];
      try { const dRes = await pool.query(`SELECT id, sum, date FROM deposits WHERE LOWER(nick) = LOWER($1) AND status = 'approved' AND seen = FALSE ORDER BY id DESC`, [guest.name]); unseen = dRes.rows; } catch(e) {}
      const bonuses = [];
      const bonusBal = parseFloat(guest.bonus_balance) || 0;
      const wagerReq = parseFloat(guest.wagering_required) || 0;
      const wagerDone = parseFloat(guest.wagering_done) || 0;
      const wagerLeft = Math.max(0, wagerReq - wagerDone);
      if (bonusBal > 0) bonuses.push({ id: 'rank_bonus_' + (guest.rank || 'Bronze'), type: 'rank', title: 'Бонус за повышение ранга', desc: 'Начислен за достижение ранга ' + (guest.rank || 'Bronze') + (wagerLeft > 0 ? `. Отыграно ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽.` : '.'), amount: bonusBal, can_refuse: true, status: 'active', wager: wagerReq > 0 ? ('x' + (wagerReq / Math.max(bonusBal, 1)).toFixed(0)) : null });
      return sendJSON(res, 200, { guest, unseen_deposits: unseen, bonuses, wagering: { required: wagerReq, done: wagerDone, left: wagerLeft }, balance: { total: (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0), deposit: parseFloat(guest.deposit_balance) || 0, bonus: parseFloat(guest.bonus_balance) || 0 } });
    }
    if (url === '/api/guest/refuse-bonus' && method === 'POST') {
      const b = await parseBody(req);
      const id = String(b.id || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      const g = await getGuestById(id);
      if (!g) return sendJSON(res, 404, { error: 'Гость не найден' });
      const bonusBal = parseFloat(g.bonus_balance) || 0;
      if (bonusBal <= 0) return sendJSON(res, 400, { error: 'Нет активных бонусов' });
      await pool.query(`UPDATE guests SET bonus_balance = 0, bonus_text = '', bonus_code = '', wagering_required = 0, wagering_done = 0 WHERE id = $1`, [id]);
      return sendJSON(res, 200, { ok: true, refunded: bonusBal });
    }
    if (url === '/api/guest/withdraw-real' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.id || '').trim();
      const sum = Math.round((parseFloat(b.sum) || 0) * 100) / 100;
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите в аккаунт' });
      if (sum < 500) return sendJSON(res, 400, { error: 'Минимальная сумма вывода — 500 ₽' });
      if (sum > 10000) return sendJSON(res, 400, { error: 'Максимальная сумма вывода — 10 000 ₽' });
      const gRes = await pool.query('SELECT * FROM guests WHERE id=$1', [guestId]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const g = gRes.rows[0];
      if ((RANK_INDEX[g.rank] || 1) < 2) return sendJSON(res, 403, { error: 'Вывод доступен с ранга Silver' });
      const dep = parseFloat(g.deposit_balance) || 0;
      const bon = parseFloat(g.bonus_balance) || 0;
      const wagerReq = parseFloat(g.wagering_required) || 0;
      const wagerDone = parseFloat(g.wagering_done) || 0;
      if (wagerReq > 0 && wagerDone < wagerReq && bon > 0) return sendJSON(res, 400, { error: `Сначала отыграйте бонус: ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽` });
      if (dep < sum) return sendJSON(res, 400, { error: `Недостаточно средств. Доступно: ${dep.toFixed(2)} ₽` });
      await pool.query('UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2', [sum, g.id]);
      const fee = Math.round(sum * 0.15 * 100) / 100;
      const net = Math.round((sum - fee) * 100) / 100;
      const r = await pool.query(`INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [todayStr(), g.name, '', sum, fee, net, 'pending']);
      try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', sum, `Withdraw request (${g.name})`]); } catch(e) {}
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0], fee, net, balance: dep - sum, deposit_balance: dep - sum, bonus_balance: bon });
    }
    if (url === '/api/guest/cancel-withdrawal' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.id || '').trim();
      const withdrawalId = parseInt(b.withdrawal_id, 10);
      if (!guestId || !withdrawalId) return sendJSON(res, 400, { error: 'no data' });
      const gRes = await pool.query('SELECT * FROM guests WHERE id=$1', [guestId]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const g = gRes.rows[0];
      const wRes = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [withdrawalId]);
      if (!wRes.rows.length) return sendJSON(res, 404, { error: 'Заявка не найдена' });
      const w = wRes.rows[0];
      if (String(w.nick || '').toLowerCase() !== String(g.name || '').toLowerCase()) return sendJSON(res, 403, { error: 'Это не ваша заявка' });
      if (w.status !== 'pending') return sendJSON(res, 400, { error: 'Заявку уже нельзя отменить' });
      await pool.query(`UPDATE withdrawals SET status='cancelled' WHERE id=$1`, [withdrawalId]);
      await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2', [parseFloat(w.sum) || 0, g.id]);
      try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', parseFloat(w.sum) || 0, `Withdraw cancelled (${g.name})`]); } catch(e) {}
      return sendJSON(res, 200, { ok: true, refunded: parseFloat(w.sum) || 0 });
    }

    // === ДЕПОЗИТЫ / ВЫВОДЫ / ПЛАТЕЖИ ===
    if (url === '/api/deposits' && method === 'GET') { const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/deposits' && method === 'POST') {
      const d = await parseBody(req);
      const amt = parseFloat(d.sum) || 0;
      if (amt < 100) return sendJSON(res, 400, { error: 'Минимальное пополнение — 100 ₽' });
      if (amt > 10000) return sendJSON(res, 400, { error: 'Максимальное пополнение — 10 000 ₽' });
      const r = await pool.query(`INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [d.date,d.nick,d.email,d.sum,d.status||'pending']);
      return sendJSON(res, 200, { ok: true, deposit: r.rows[0] });
    }
    if (url.startsWith('/api/deposits/') && url.endsWith('/seen') && method === 'POST') { const id = url.split('/')[3]; await pool.query(`UPDATE deposits SET seen = TRUE WHERE id=$1`, [id]); return sendJSON(res, 200, { ok: true }); }
    if (url.startsWith('/api/deposits/') && method === 'PUT') {
      const id = url.split('/')[3];
      const d = await parseBody(req);
      const beforeRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if (beforeRes.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const dep = beforeRes.rows[0];
      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);
      if (d.status === 'approved' && dep.status !== 'approved') {
        const sum = parseFloat(dep.sum) || 0;
        await addBalanceByNick(dep.nick, sum, false);
        try {
          const prevApproved = await pool.query(`SELECT COUNT(*)::int AS c FROM deposits WHERE LOWER(nick)=LOWER($1) AND status='approved' AND id != $2`, [dep.nick, id]);
          const isFirstDeposit = (prevApproved.rows[0]?.c || 0) === 0;
          if (isFirstDeposit && sum >= 200) {
            const gRes = await pool.query(`SELECT id FROM guests WHERE LOWER(name)=LOWER($1) LIMIT 1`, [dep.nick]);
            if (gRes.rows.length > 0) await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1, wagering_required = wagering_required + $2 WHERE id = $3`, [100, 2000, gRes.rows[0].id]);
          }
        } catch(e) {}
        await pool.query(`UPDATE deposits SET seen = FALSE WHERE id=$1`, [id]);
      }
      if (d.status === 'rejected' && dep.status === 'approved') {
        const g = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [dep.nick]);
        if (g.rows.length > 0) await pool.query('UPDATE guests SET deposit_balance = GREATEST(0, deposit_balance - $1) WHERE id=$2', [parseFloat(dep.sum) || 0, g.rows[0].id]);
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (url.startsWith('/api/deposits/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM deposits WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/withdrawals' && method === 'GET') { const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/withdrawals' && method === 'POST') {
      const w = await parseBody(req);
      const nick = String(w.nick || '').trim();
      const email = String(w.email || '').trim();
      const sum = Math.round((parseFloat(w.sum) || 0) * 100) / 100;
      if (!nick) return sendJSON(res, 400, { error: 'Укажите ник' });
      if (!email) return sendJSON(res, 400, { error: 'Укажите email' });
      if (sum < 100) return sendJSON(res, 400, { error: 'Минимальная сумма вывода — 100 ₽' });
      const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nick]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок с таким ником не найден' });
      const g = gRes.rows[0];
      const dep = parseFloat(g.deposit_balance) || 0;
      const bon = parseFloat(g.bonus_balance) || 0;
      const wagerReq = parseFloat(g.wagering_required) || 0;
      const wagerDone = parseFloat(g.wagering_done) || 0;
      if (wagerReq > 0 && wagerDone < wagerReq && bon > 0) return sendJSON(res, 400, { error: `Сначала отыграйте бонус: ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽` });
      if (dep < sum) return sendJSON(res, 400, { error: `Недостаточно средств. Доступно на вывод: ${dep.toFixed(2)} ₽` });
      await pool.query(`UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2`, [sum, g.id]);
      const fee = Math.round(sum * 0.05 * 100) / 100;
      const net = Math.round((sum - fee) * 100) / 100;
      const r = await pool.query(`INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [w.date || todayStr(), nick, email, sum, fee, net, 'pending']);
      try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', sum, `Withdraw request (${nick})`]); } catch(e) {}
      const bal = await getBalance(g.id);
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0], balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
    }
    if (url.startsWith('/api/withdrawals/') && method === 'PUT') {
      const id = url.split('/')[3];
      const w = await parseBody(req);
      const beforeRes = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
      if (!beforeRes.rows.length) return sendJSON(res, 404, { error: 'not found' });
      const wd = beforeRes.rows[0];
      await pool.query('UPDATE withdrawals SET status=$1 WHERE id=$2', [w.status, id]);
      if (w.status === 'rejected' && wd.status !== 'rejected') {
        const g = await pool.query('SELECT id FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [wd.nick]);
        if (g.rows.length) {
          await pool.query('UPDATE guests SET deposit_balance = deposit_balance + $1 WHERE id=$2', [parseFloat(wd.sum) || 0, g.rows[0].id]);
          try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', parseFloat(wd.sum) || 0, `Withdraw rejected (${wd.nick})`]); } catch(e) {}
        }
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (url.startsWith('/api/withdrawals/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM withdrawals WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/payouts' && method === 'GET') { const r = await pool.query('SELECT * FROM payouts ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/payouts' && method === 'POST') {
      const p = await parseBody(req);
      const r = await pool.query(`INSERT INTO payouts (date,dealer,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`, [p.date,p.dealer,p.sum,p.note]);
      return sendJSON(res, 200, { ok: true, payout: r.rows[0] });
    }
    if (url.startsWith('/api/payouts/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM payouts WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/players' && method === 'GET') { const r = await pool.query('SELECT * FROM players ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/players' && method === 'POST') {
      const p = await parseBody(req);
      const r = await pool.query(`INSERT INTO players (nick,vip,blocked) VALUES ($1,$2,$3) ON CONFLICT (nick) DO UPDATE SET vip=EXCLUDED.vip, blocked=EXCLUDED.blocked RETURNING *`, [p.nick,p.vip||false,p.blocked||false]);
      return sendJSON(res, 200, { ok: true, player: r.rows[0] });
    }

    if (url === '/api/audit' && method === 'GET') { const r = await pool.query('SELECT * FROM audit ORDER BY id DESC LIMIT 500'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/audit' && method === 'POST') {
      const a = await parseBody(req);
      const r = await pool.query(`INSERT INTO audit (time,user_name,action,details) VALUES ($1,$2,$3,$4) RETURNING *`, [a.time,a.user,a.action,a.details]);
      return sendJSON(res, 200, { ok: true, audit: r.rows[0] });
    }
    if (url === '/api/audit' && method === 'DELETE') { await pool.query('DELETE FROM audit'); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/employees' && method === 'GET') { const r = await pool.query('SELECT id,name,login,role FROM employees ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/employees' && method === 'POST') {
      const e = await parseBody(req);
      try { const r = await pool.query(`INSERT INTO employees (name,login,pass,role) VALUES ($1,$2,$3,$4) RETURNING id,name,login,role`, [e.name,e.login,e.pass,e.role]); return sendJSON(res, 200, { ok: true, employee: r.rows[0] }); }
      catch(err) { return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if (url.startsWith('/api/employees/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM employees WHERE id=$1 AND role!=$2', [id, 'owner']); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/dealers' && method === 'GET') { const r = await pool.query('SELECT id,name,login FROM dealers ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/dealers' && method === 'POST') {
      const d = await parseBody(req);
      try { const r = await pool.query(`INSERT INTO dealers (name,login,pass) VALUES ($1,$2,$3) RETURNING id,name,login`, [d.name,d.login,d.pass]); return sendJSON(res, 200, { ok: true, dealer: r.rows[0] }); }
      catch(err) { return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if (url.startsWith('/api/dealers/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM dealers WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/online' && method === 'GET') { const r = await pool.query('SELECT * FROM online ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if (url === '/api/online' && method === 'POST') {
      const o = await parseBody(req);
      const r = await pool.query(`INSERT INTO online (date,type,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`, [o.date,o.type,o.sum,o.note]);
      return sendJSON(res, 200, { ok: true, online: r.rows[0] });
    }
    if (url.startsWith('/api/online/') && method === 'DELETE') { const id = url.split('/')[3]; await pool.query('DELETE FROM online WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    if (url === '/api/login' && method === 'POST') {
      const { login, pass, type } = await parseBody(req);
      if (type === 'dealer') {
        const r = await pool.query('SELECT * FROM dealers WHERE login=$1 AND pass=$2', [login, pass]);
        if (r.rows.length === 0) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
        const balance = await getDealerBalance(r.rows[0].id);
        return sendJSON(res, 200, { ok: true, dealer: { id: r.rows[0].id, name: r.rows[0].name, balance } });
      } else {
        const r = await pool.query('SELECT * FROM employees WHERE login=$1 AND pass=$2', [login, pass]);
        if (r.rows.length === 0) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
        return sendJSON(res, 200, { ok: true, employee: { id: r.rows[0].id, name: r.rows[0].name, role: r.rows[0].role } });
      }
    }

    if (url === '/api/dealer/tasks' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealerId = parseInt(u.searchParams.get('id'), 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no id' });
      try {
        const dRes = await pool.query(`SELECT name FROM dealers WHERE id=$1`, [dealerId]);
        if (!dRes.rows.length) return sendJSON(res, 404, { error: 'Дилер не найден' });
        const dealerName = dRes.rows[0].name;
        const tasks = getDealerTasksForToday();
        const claimedRes = await pool.query(`SELECT task_id FROM dealer_tasks WHERE dealer_id=$1 AND date=$2 AND claimed=TRUE`, [dealerId, todayStr()]);
        const claimedSet = new Set(claimedRes.rows.map(r => r.task_id));
        const earned = await getDealerEarnedToday(dealerId);
        const limitReached = earned >= DEALER_DAILY_LIMIT;
        const list = [];
        for (const t of tasks) {
          const hands = await getDealerHandsTodayByType(dealerName, t.type);
          const claimed = claimedSet.has(t.id);
          const done = hands >= t.goal;
          const canClaim = done && !claimed && !limitReached;
          list.push({ id: t.id, title: t.title, goal: t.goal, reward: t.reward, type: t.type, progress: Math.min(hands, t.goal), done, claimed, canClaim, blocked: limitReached && !claimed });
        }
        return sendJSON(res, 200, { day: todayStr(), tasks: list, earned_today: earned, daily_limit: DEALER_DAILY_LIMIT, limit_reached: limitReached });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/tasks/claim' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      const taskId = String(b.task_id || '');
      if (!dealerId || !taskId) return sendJSON(res, 400, { error: 'no data' });
      try {
        const tasks = getDealerTasksForToday();
        const task = tasks.find(t => t.id === taskId);
        if (!task) return sendJSON(res, 404, { error: 'Задание не найдено' });
        const dRes = await pool.query(`SELECT name FROM dealers WHERE id=$1`, [dealerId]);
        if (!dRes.rows.length) return sendJSON(res, 404, { error: 'Дилер не найден' });
        const hands = await getDealerHandsTodayByType(dRes.rows[0].name, task.type);
        if (hands < task.goal) return sendJSON(res, 400, { error: `Не выполнено: ${hands} / ${task.goal}` });
        const existing = await pool.query(`SELECT * FROM dealer_tasks WHERE dealer_id=$1 AND date=$2 AND task_id=$3 AND claimed=TRUE`, [dealerId, todayStr(), taskId]);
        if (existing.rows.length) return sendJSON(res, 400, { error: 'Уже получено' });
        const earned = await getDealerEarnedToday(dealerId);
        if (earned + task.reward > DEALER_DAILY_LIMIT) return sendJSON(res, 400, { error: 'Лимит на сегодня' });
        await pool.query(`INSERT INTO dealer_tasks (dealer_id, date, task_id, claimed, reward) VALUES ($1,$2,$3,TRUE,$4) ON CONFLICT (dealer_id, date, task_id) DO UPDATE SET claimed=TRUE, reward=$4`, [dealerId, todayStr(), taskId, task.reward]);
        await addDealerBalance(dealerId, task.reward);
        return sendJSON(res, 200, { ok: true, reward: task.reward });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/silence' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const dealerId = parseInt(u.searchParams.get('id'), 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query(`SELECT * FROM dealer_silence WHERE dealer_id=$1`, [dealerId]);
        if (!r.rows.length) return sendJSON(res, 200, { percent: 10, days_passed: 0, days_left: 7 });
        const s = r.rows[0];
        const weekStart = parseInt(s.week_start) || Date.now();
        const daysPassed = Math.floor((Date.now() - weekStart) / (1000*60*60*24));
        const daysLeft = Math.max(0, 7 - daysPassed);
        return sendJSON(res, 200, { percent: s.incident ? 7 : 10, days_passed: Math.min(7, daysPassed), days_left: daysLeft });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/balance' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = parseInt(u.searchParams.get('id'), 10);
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const dRes = await pool.query(`SELECT id, name FROM dealers WHERE id=$1`, [id]);
        if (!dRes.rows.length) return sendJSON(res, 404, { error: 'Не найден' });
        const balance = await getDealerBalance(id);
        const wRes = await pool.query(`SELECT id, sum, fee, net, status, created_at AS date FROM dealer_withdrawals WHERE dealer_id=$1 ORDER BY id DESC LIMIT 50`, [id]);
        return sendJSON(res, 200, { dealer: { ...dRes.rows[0], balance }, withdrawals: wRes.rows });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/withdraw' && method === 'POST') {
      const b = await parseBody(req);
      const id = parseInt(b.id, 10);
      const sum = parseFloat(b.sum) || 0;
      const card = String(b.card || '').trim();
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      if (sum < 100) return sendJSON(res, 400, { error: 'Мин. вывод 100 ₽' });
      if (!card) return sendJSON(res, 400, { error: 'Укажите карту' });
      try {
        const balance = await getDealerBalance(id);
        if (sum > balance) return sendJSON(res, 400, { error: 'Недостаточно средств' });
        const fee = Math.round(sum * 0.07 * 100) / 100;
        const net = Math.round((sum - fee) * 100) / 100;
        await addDealerBalance(id, -sum);
        await pool.query(`INSERT INTO dealer_withdrawals (dealer_id, sum, fee, net, status, card) VALUES ($1,$2,$3,$4,'pending',$5)`, [id, sum, fee, net, card]);
        return sendJSON(res, 200, { ok: true, sum, fee, net });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/profile' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = parseInt(u.searchParams.get('id'), 10);
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const dRes = await pool.query(`SELECT id, name, login, created_at FROM dealers WHERE id=$1`, [id]);
        if (!dRes.rows.length) return sendJSON(res, 404, { error: 'Не найден' });
        const d = dRes.rows[0];
        const balance = await getDealerBalance(id);
        const rRes = await pool.query(`SELECT AVG(stars) AS avg FROM dealer_reviews WHERE LOWER(dealer_name)=LOWER($1)`, [d.name]);
        const avgStars = parseFloat(rRes.rows[0]?.avg) || 0;
        const sRes = await pool.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(dep), 0)::numeric AS t FROM sessions WHERE LOWER(dealer)=LOWER($1)`, [d.name]);
        const sess = sRes.rows[0]?.c || 0;
        const turnover = parseFloat(sRes.rows[0]?.t) || 0;
        const points = Math.floor(turnover * DEALER_POINTS_PER_RUB);
        const rank = getDealerRank(points);
        const nextRank = DEALER_RANKS[DEALER_RANKS.findIndex(r => r.key === rank.key) + 1];
        const progress = nextRank ? Math.min(100, Math.round((points - rank.min) / (nextRank.min - rank.min) * 100)) : 100;
        return sendJSON(res, 200, { dealer: { ...d, balance, avg_stars: avgStars, points, sessions: sess, total_turnover: turnover, rank_label: rank.label, rank_color: rank.color, rank_percent: rank.percent, rank_bonus: rank.bonus, next_label: nextRank ? `До ${nextRank.label}` : 'Максимум', next_rank_label: nextRank?.label || '', points_to_next: nextRank ? Math.max(0, nextRank.min - points) : 0, progress_pct: progress } });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/change-password' && method === 'POST') {
      const b = await parseBody(req);
      const id = parseInt(b.dealer_id, 10);
      const oldPass = String(b.old_pass || '');
      const newPass = String(b.new_pass || '');
      if (!id || !oldPass || !newPass) return sendJSON(res, 400, { error: 'no data' });
      if (newPass.length < 4) return sendJSON(res, 400, { error: 'Слишком короткий' });
      try {
        const r = await pool.query(`SELECT 1 FROM dealers WHERE id=$1 AND pass=$2`, [id, oldPass]);
        if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный пароль' });
        await pool.query(`UPDATE dealers SET pass=$1 WHERE id=$2`, [newPass, id]);
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/cash-safe' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = parseInt(u.searchParams.get('id'), 10);
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='in' THEN sum ELSE -sum END), 0)::numeric AS in_safe, COALESCE(SUM(CASE WHEN type='in' THEN sum ELSE 0 END), 0)::numeric AS total_in, COALESCE(SUM(CASE WHEN type='out' THEN sum ELSE 0 END), 0)::numeric AS total_out FROM cash_safe WHERE dealer_id=$1 AND status='open'`, [id]);
        return sendJSON(res, 200, { in_safe: parseFloat(r.rows[0].in_safe) || 0, total_in: parseFloat(r.rows[0].total_in) || 0, total_out: parseFloat(r.rows[0].total_out) || 0 });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/cash-history' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = parseInt(u.searchParams.get('id'), 10);
      if (!id) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query(`SELECT * FROM cash_safe WHERE dealer_id=$1 ORDER BY id DESC LIMIT 50`, [id]);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/cash-in' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      const nick = String(b.nick || '').trim();
      const sum = parseFloat(b.sum) || 0;
      const pass = String(b.pass || '');
      if (!dealerId || !nick || sum <= 0) return sendJSON(res, 400, { error: 'no data' });
      try {
        const r = await pool.query(`SELECT name FROM dealers WHERE id=$1 AND pass=$2`, [dealerId, pass]);
        if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный пароль' });
        await pool.query(`INSERT INTO cash_safe (dealer_id, dealer_name, guest_name, sum, type, date) VALUES ($1,$2,$3,$4,'in',$5)`, [dealerId, r.rows[0].name, nick, sum, todayStr()]);
        return sendJSON(res, 200, { ok: true, guest: nick });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/cash-out' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      const nick = String(b.nick || '').trim();
      const sum = parseFloat(b.sum) || 0;
      const pass = String(b.pass || '');
      if (!dealerId || !nick || sum <= 0) return sendJSON(res, 400, { error: 'no data' });
      try {
        const r = await pool.query(`SELECT name FROM dealers WHERE id=$1 AND pass=$2`, [dealerId, pass]);
        if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный пароль' });
        await pool.query(`INSERT INTO cash_safe (dealer_id, dealer_name, guest_name, sum, type, date) VALUES ($1,$2,$3,$4,'out',$5)`, [dealerId, r.rows[0].name, nick, sum, todayStr()]);
        return sendJSON(res, 200, { ok: true, guest: nick });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/cash-handover' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      if (!dealerId) return sendJSON(res, 400, { error: 'no id' });
      try {
        const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='in' THEN sum ELSE -sum END), 0)::numeric AS total FROM cash_safe WHERE dealer_id=$1 AND status='open'`, [dealerId]);
        await pool.query(`UPDATE cash_safe SET status='handed', handed_at=NOW() WHERE dealer_id=$1 AND status='open'`, [dealerId]);
        return sendJSON(res, 200, { ok: true, expected: parseFloat(r.rows[0].total) || 0 });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/pending-transfers' && method === 'GET') {
      try { const r = await pool.query(`SELECT * FROM deposits WHERE status='pending' ORDER BY id DESC LIMIT 50`); return sendJSON(res, 200, r.rows); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/dealer/issue-chips' && method === 'POST') {
      const b = await parseBody(req);
      const depositId = parseInt(b.deposit_id, 10);
      if (!depositId) return sendJSON(res, 400, { error: 'no id' });
      try {
        const dRes = await pool.query(`SELECT * FROM deposits WHERE id=$1`, [depositId]);
        if (!dRes.rows.length) return sendJSON(res, 404, { error: 'Депозит не найден' });
        const d = dRes.rows[0];
        await pool.query(`UPDATE deposits SET status='approved' WHERE id=$1`, [depositId]);
        await addBalanceByNick(d.nick, d.sum, false);
        return sendJSON(res, 200, { ok: true, nick: d.nick, sum: parseFloat(d.sum) || 0 });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/admin/chips-summary' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const date = u.searchParams.get('date') || todayStr();
      try {
        const r = await pool.query(`SELECT dealer_name, COALESCE(SUM(CASE WHEN type='in' THEN sum ELSE 0 END), 0)::numeric AS total_in, COALESCE(SUM(CASE WHEN type='out' THEN sum ELSE 0 END), 0)::numeric AS total_out FROM cash_safe WHERE date=$1 GROUP BY dealer_name`, [date]);
        const dealers = r.rows.map(x => ({ dealer_name: x.dealer_name, totalIn: parseFloat(x.total_in) || 0, totalOut: parseFloat(x.total_out) || 0, profit: (parseFloat(x.total_out) || 0) - (parseFloat(x.total_in) || 0) }));
        const grandIn = dealers.reduce((a, x) => a + x.totalIn, 0);
        const grandOut = dealers.reduce((a, x) => a + x.totalOut, 0);
        return sendJSON(res, 200, { dealers, grandIn, grandOut, grandProfit: grandOut - grandIn });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/admin/cash-safe' && method === 'GET') {
      try {
        const r = await pool.query(`SELECT dealer_id, dealer_name, COALESCE(SUM(CASE WHEN type='in' THEN sum ELSE -sum END), 0)::numeric AS open_total, 0 AS handed_total, 0 AS handed_cnt FROM cash_safe WHERE status='open' GROUP BY dealer_id, dealer_name`);
        return sendJSON(res, 200, { dealers: r.rows.map(x => ({ dealer_id: x.dealer_id, dealer_name: x.dealer_name, open_total: parseFloat(x.open_total) || 0, handed_total: 0, handed_cnt: 0 })) });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === РАЗДАЧА СТАТИКИ ===
    let file = url === '/' ? '/index.html' : decodeURIComponent(url);
    const safeRelative = path.normalize(file).replace(/^(\.\.[\/\\])+/, '').replace(/^[\/\\]+/, '');
    const filePath = path.join(__dirname, safeRelative);
    if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (/\.(png|jpg|jpeg|webp|svg|gif|mp3|wav)$/i.test(safeRelative)) console.log(`[404] Статика не найдена: ${safeRelative}`);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': mime };
    if (/^image\//.test(mime)) { headers['Cache-Control'] = 'public, max-age=3600'; console.log(`[STATIC] ${safeRelative} → ${mime}`); }
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
  console.log('  Roulette: /roulette.html');
  console.log('  Tournament: /tournament.html');
  console.log('');
});
