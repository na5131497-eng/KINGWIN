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

// Игры
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
      note NOT ILIKE '%бонус%' AND note NOT ILIKE '%bonus%'
      AND note NOT ILIKE '%ранг%' AND note NOT ILIKE '%rank%'
      AND note NOT ILIKE '%daily%' AND note NOT ILIKE '%подарок%'
      AND note NOT ILIKE '%gift%' AND note NOT ILIKE '%admin%'
      AND note NOT ILIKE '%refuse%' AND note NOT ILIKE '%cancel%'
      AND note NOT ILIKE '%withdraw request%' AND note NOT ILIKE '%withdraw reject%'`;
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
    const t = await pool.query(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
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
      CREATE TABLE IF NOT EXISTS roulette_sessions (id SERIAL PRIMARY KEY, dealer TEXT NOT NULL, nick TEXT NOT NULL, bet_type TEXT NOT NULL, bet_number INTEGER, bet NUMERIC NOT NULL, win NUMERIC NOT NULL, won INTEGER, bet_source TEXT DEFAULT 'real', date TEXT, result_number INTEGER, result_color TEXT, created_at TIMESTAMP DEFAULT NOW());
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
      `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS guest_id TEXT`,
      `ALTER TABLE roulette_sessions ADD COLUMN IF NOT EXISTS result_number INTEGER`,
      `ALTER TABLE roulette_sessions ADD COLUMN IF NOT EXISTS result_color TEXT`
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
        return;
      }
      const winner = await pool.query(`SELECT * FROM tournament_entries WHERE tournament_id=$1 ORDER BY score DESC LIMIT 1`, [tour.id]);
      if (!winner.rows.length) { await pool.query(`UPDATE tournaments SET status='cancelled' WHERE id=$1`, [tour.id]); return; }
      const w = winner.rows[0];
      await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2`, [tour.prize_pool, w.guest_id]);
      await pool.query(`UPDATE tournaments SET status='finished', winner_id=$1, winner_name=$2, winner_score=$3 WHERE id=$4`,
        [w.guest_id, w.guest_name, w.score, tour.id]);
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
    giftText = `Поздравляем с достижением ранга ${newRank}! Вам подарок ${giftMoney} бонусных рублей.`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }
  const addWagerReqRank = giftMoney * 5;
  await pool.query(`UPDATE guests SET points = $1, rank = $2, last_rank = $3, bonus_text = $4, bonus_code = $5, bonus_balance = bonus_balance + $6, wagering_required = wagering_required + $7 WHERE id = $8`, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReqRank, guest.id]);
  await pool.query(`UPDATE guests SET wagering_done = wagering_done + $1 WHERE id=$2`, [rubAmount, guest.id]);
  return { guestId: guest.id, newRank, giftMoney };
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

async function getGuestByName(nick) {
  try {
    const r = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [String(nick).trim()]);
    return r.rows[0] || null;
  } catch (e) { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    // === HEALTH ===
    if (url === '/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
    }

    // === API ДЛЯ ВЫВОДА ИЗ КАССЫ ===
    if (url === '/api/admin/treasury/withdraw' && method === 'POST') {
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Нет доступа' });
      const amount = parseFloat(b.amount) || 0;
      if (amount <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть больше 0' });
      
      try {
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`, 
          [todayStr(), amount, 'Owner Withdraw: Вывод владельца из кассы']);
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }

    // === API ДЛЯ RTP ИГРОКА ===
    if (url === '/api/admin/player/rtp' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const guestId = u.searchParams.get('id');
      if (!guestId) return sendJSON(res, 400, { error: 'no id' });
      try {
        const rtp = await getTargetRTP(guestId);
        const todayProfit = await getPlayerTodayProfit(guestId);
        return sendJSON(res, 200, { 
          rtp: Math.round(rtp * 100), 
          profitToday: todayProfit 
        });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }

    // === 7: ПОСЛЕДНИЕ ВЫИГРЫШИ ===
    if (url === '/api/last-wins' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(50, parseInt(u.searchParams.get('limit'), 10) || 20);
      try {
        const r = await pool.query(`
          SELECT 'roulette' AS game, nick AS player, bet, win, CASE WHEN bet > 0 THEN ROUND((win / bet)::numeric, 2) ELSE 0 END AS mult, result_number, result_color, created_at FROM roulette_sessions WHERE win > 0 AND win >= bet * 1.5
          UNION ALL
          SELECT 'crash' AS game, player_name AS player, amount AS bet, amount * cashout_mult AS win, ROUND(cashout_mult::numeric, 2) AS mult, NULL AS result_number, NULL AS result_color, created_at FROM crash_bets WHERE cashed_out = TRUE AND cashout_mult >= 2 AND player_id NOT LIKE 'BOT%'
          UNION ALL
          SELECT game AS game, player_name AS player, bet, result AS win, CASE WHEN bet > 0 THEN ROUND((result / bet)::numeric, 2) ELSE 0 END AS mult, NULL AS result_number, NULL AS result_color, created_at FROM game_history WHERE result > bet AND result >= bet * 1.5 AND game IN ('miner','plinko','ladder','cases','empire_of_gold')
          ORDER BY created_at DESC LIMIT $1
        `, [limit]);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ГОСТИ И ПРОЧЕЕ ===
    if(url === '/api/guests' && method === 'GET'){ const r = await pool.query('SELECT * FROM guests ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/guests' && method === 'POST'){
      const g = await parseBody(req);
      const cardId = g.id || Math.floor(10000000 + Math.random() * 90000000).toString();
      const r = await pool.query(`INSERT INTO guests (id, name, rank, points, visits, bonus_text, bonus_code, pass) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [cardId, g.name, g.rank || 'Bronze', g.points || 0, g.visits || 0, g.bonus_text || '', g.bonus_code || '', g.pass || '1234']);
      return sendJSON(res, 200, { ok: true, guest: r.rows[0] });
    }
    if(url === '/api/guests/delete' && method === 'POST'){ const g = await parseBody(req); await pool.query('DELETE FROM guests WHERE id=$1', [g.id]); return sendJSON(res, 200, { ok: true }); }
    if(url === '/api/guests/update' && method === 'POST'){
      const g = await parseBody(req);
      if(!g.id) return sendJSON(res, 400, { error: 'no id' });
      try { await pool.query(`UPDATE guests SET name = $1, rank = $2, pass = $3, bonus_text = $4, bonus_code = $5, bonus_balance = $6 WHERE id = $7`, [g.name, g.rank, g.pass, g.bonus_text, g.bonus_code, g.bonus_balance || 0, g.id]); return sendJSON(res, 200, { ok: true }); }
      catch(e){ return sendJSON(res, 500, { error: e.message }); }
    }
    if(url === '/api/guest/login' && method === 'POST'){
      const { id, pass } = await parseBody(req);
      if(!id || !pass) return sendJSON(res, 400, { error: 'Введите карту и пароль' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id).trim()]);
      if(r.rows.length === 0) return sendJSON(res, 401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      if(String(pass) !== String(g.pass || '1234')) return sendJSON(res, 401, { error: 'Неверный пароль' });
      try { await pool.query('UPDATE guests SET visits = visits + 1, last_visit = NOW() WHERE id=$1', [g.id]); } catch(e){}
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
      try { const dRes = await pool.query(`SELECT id, sum, date FROM deposits WHERE LOWER(nick) = LOWER($1) AND status = 'approved' AND seen = FALSE ORDER BY id DESC`, [guest.name]); unseen = dRes.rows; } catch(e) {}
      const bonuses = [];
      const bonusBal = parseFloat(guest.bonus_balance) || 0;
      const wagerReq = parseFloat(guest.wagering_required) || 0;
      const wagerDone = parseFloat(guest.wagering_done) || 0;
      const wagerLeft = Math.max(0, wagerReq - wagerDone);
      if (bonusBal > 0) bonuses.push({ id: 'rank_bonus_' + (guest.rank || 'Bronze'), type: 'rank', title: 'Бонус за ранг', desc: 'Ранг ' + (guest.rank || 'Bronze') + (wagerLeft > 0 ? `. Отыграно ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽.` : '.'), amount: bonusBal, can_refuse: true, status: 'active', wager: wagerReq > 0 ? ('x' + (wagerReq / Math.max(bonusBal, 1)).toFixed(0)) : null });
      return sendJSON(res, 200, { guest, unseen_deposits: unseen, bonuses, wagering: { required: wagerReq, done: wagerDone, left: wagerLeft }, balance: { total: (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0), deposit: parseFloat(guest.deposit_balance) || 0, bonus: parseFloat(guest.bonus_balance) || 0 } });
    }

    // === ДЕПОЗИТЫ ===
    if(url === '/api/deposits' && method === 'GET'){ const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/deposits' && method === 'POST'){
      const d = await parseBody(req);
      const amt = parseFloat(d.sum) || 0;
      if (amt < 100) return sendJSON(res, 400, { error: 'Мин 100 ₽' });
      if (amt > 10000) return sendJSON(res, 400, { error: 'Макс 10000 ₽' });
      const r = await pool.query(`INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [d.date,d.nick,d.email,d.sum,d.status||'pending']);
      return sendJSON(res, 200, { ok: true, deposit: r.rows[0] });
    }
    if (url.startsWith('/api/deposits/') && url.endsWith('/seen') && method === 'POST') { const id = url.split('/')[3]; await pool.query(`UPDATE deposits SET seen = TRUE WHERE id=$1`, [id]); return sendJSON(res, 200, { ok: true }); }
    if(url.startsWith('/api/deposits/') && method === 'PUT'){
      const id = url.split('/')[3];
      const d = await parseBody(req);
      const beforeRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if(beforeRes.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const dep = beforeRes.rows[0];
      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);
      if(d.status === 'approved' && dep.status !== 'approved'){
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
      if(d.status === 'rejected' && dep.status === 'approved'){
        const g = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [dep.nick]);
        if(g.rows.length > 0) await pool.query('UPDATE guests SET deposit_balance = GREATEST(0, deposit_balance - $1) WHERE id=$2', [parseFloat(dep.sum) || 0, g.rows[0].id]);
      }
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/deposits/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM deposits WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    // === ВЫВОДЫ ===
    if(url === '/api/withdrawals' && method === 'GET'){ const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/withdrawals' && method === 'POST'){
      const w = await parseBody(req);
      const nick = String(w.nick || '').trim();
      const email = String(w.email || '').trim();
      const sum = Math.round((parseFloat(w.sum) || 0) * 100) / 100;
      if (!nick) return sendJSON(res, 400, { error: 'Укажите ник' });
      if (!email) return sendJSON(res, 400, { error: 'Укажите email' });
      if (sum < 100) return sendJSON(res, 400, { error: 'Мин 100 ₽' });
      const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1`, [nick]);
      if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Не найден' });
      const g = gRes.rows[0];
      const dep = parseFloat(g.deposit_balance) || 0;
      const bon = parseFloat(g.bonus_balance) || 0;
      const wagerReq = parseFloat(g.wagering_required) || 0;
      const wagerDone = parseFloat(g.wagering_done) || 0;
      if (wagerReq > 0 && wagerDone < wagerReq && bon > 0) return sendJSON(res, 400, { error: `Отыграйте: ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽` });
      if (dep < sum) return sendJSON(res, 400, { error: `Доступно: ${dep.toFixed(2)} ₽` });
      await pool.query(`UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2`, [sum, g.id]);
      const fee = Math.round(sum * 0.05 * 100) / 100;
      const net = Math.round((sum - fee) * 100) / 100;
      const r = await pool.query(`INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [w.date || todayStr(), nick, email, sum, fee, net, 'pending']);
      try { await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', sum, `Withdraw request (${nick})`]); } catch(e) {}
      const bal = await getBalance(g.id);
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0], balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
    }
    if(url.startsWith('/api/withdrawals/') && method === 'PUT'){
      const id = url.split('/')[3];
      const w = await parseBody(req);
      const beforeRes = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
      if(!beforeRes.rows.length) return sendJSON(res, 404, { error: 'not found' });
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
    if(url.startsWith('/api/withdrawals/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM withdrawals WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    // === СТАТИСТИКА И АДМИНКА ===
    if (url === '/api/admin/house/stats' && method === 'GET') {
      const all = await getCasinoStats('all');
      const today = await getCasinoStats('today');
      const h = await getHouseRTP();
      const t = await getTreasury();
      return sendJSON(res, 200, {
        all, today, treasury: t.treasury, income_total: t.income, expense_total: t.expense,
        actualRTP_today: h.actualRTP, targetRTP: h.rtp,
        targetRTP_pct: Math.round(h.rtp * 100),
        houseEdge_pct: Math.round((1 - h.rtp) * 100),
        mode: h.mode,
        label: h.mode === 'drain' ? 'жёсткий' : h.mode === 'catchup' ? 'догоняем' : 'базовый'
      });
    }

    if(url === '/api/admin/tournaments' && method === 'GET'){
      try { const r = await pool.query(`SELECT * FROM tournaments ORDER BY id DESC LIMIT 50`); return sendJSON(res, 200, r.rows); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if(url === '/api/admin/clear-all' && method === 'POST'){
      const b = await parseBody(req);
      if (String(b.pass || '') !== '56UpahoS') return sendJSON(res, 401, { error: 'Неверный пароль' });
      try {
        const tables = ['sessions','baccarat','deposits','withdrawals','payouts','online','audit','guests','crash_bets','crash_rounds','cases_log','game_history','dealer_reviews','news','promo_uses','promo_codes','cash_safe','dealer_tasks','dealer_daily','dealer_balance','dealer_withdrawals','miner_force_lose_players','roulette_sessions','tournament_entries','tournament_bets','tournaments'];
        for (const tbl of tables) { try { await pool.query(`DELETE FROM ${tbl}`); } catch(e) {} }
        queuedBets = [];
        Object.keys(ladderSessions).forEach(k => delete ladderSessions[k]);
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === РАЗДАЧА СТАТИКИ ===
    // === ИГРА: CRASH ===
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
if (url === '/api/crash/bet' && method === 'POST') {
  const b = await parseBody(req);
  const amt = parseFloat(b.amount) || 0;
  if (amt < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
  if (amt > 200) return sendJSON(res, 400, { error: 'Макс 200 ₽' });
  if (crashState.status !== 'waiting') {
    if (!b.player_id) return sendJSON(res, 400, { error: 'Войдите' });
    const bal = await getBalance(String(b.player_id));
    if (bal.total < amt) return sendJSON(res, 400, { error: 'Недостаточно' });
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
  if (b.player_id) {
    try { const gRes = await pool.query(`SELECT name FROM guests WHERE id=$1`, [String(b.player_id)]); if (gRes.rows.length > 0) { await accruePointsByNick(gRes.rows[0].name, amt, 'crash'); await trackTournamentBet(String(b.player_id), gRes.rows[0].name, 'crash', amt, 0); } } catch(e){}
  }
  const bal = b.player_id ? await getBalance(String(b.player_id)) : null;
  return sendJSON(res, 200, { ok: true, bet: r.rows[0], balance: bal ? bal.total : 0, deposit_balance: bal ? bal.deposit : 0, bonus_balance: bal ? bal.bonus : 0 });
}
if (url === '/api/crash/cashout' && method === 'POST') {
  const b = await parseBody(req);
  if (crashState.status !== 'flying') return sendJSON(res, 400, { error: 'Не в полёте' });
  const elapsed = Date.now() - crashState.startTime;
  let mult = Math.pow(1.00006, elapsed);
  if (mult >= crashState.crashPoint) return sendJSON(res, 400, { error: 'Поздно' });
  const betRes = await pool.query(`SELECT * FROM crash_bets WHERE id=$1 AND round_id=$2 AND cashed_out=false`, [b.bet_id, crashState.roundId]);
  if (!betRes.rows.length) return sendJSON(res, 400, { error: 'Ставка не найдена' });
  const bet = betRes.rows[0];
  const winAmount = (parseFloat(bet.amount) * mult);
  await pool.query(`UPDATE crash_bets SET cashed_out=true, cashout_mult=$1 WHERE id=$2`, [mult, b.bet_id]);
  let bal = null;
  if (bet.player_id && !String(bet.player_id).startsWith('BOT')) {
    await creditWin(bet.player_id, winAmount, parseFloat(bet.amount) || 0);
    bal = await getBalance(bet.player_id);
    try { const gRes = await pool.query(`SELECT name FROM guests WHERE id=$1`, [bet.player_id]); if (gRes.rows.length) await trackTournamentBet(bet.player_id, gRes.rows[0].name, 'crash', parseFloat(bet.amount) || 0, winAmount); } catch(e){}
  }
  return sendJSON(res, 200, { ok: true, mult, win: winAmount, balance: bal ? bal.total : 0, deposit_balance: bal ? bal.deposit : 0, bonus_balance: bal ? bal.bonus : 0 });
}

// === ИГРА: МИНЕР ===
if (url === '/api/miner/start' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const bet = parseFloat(b.bet) || 0;
  let mines = parseInt(b.mines, 10) || 3;
  if (mines < 1) mines = 1; if (mines > 24) mines = 24;
  if (!guestId) return sendJSON(res, 400, { error: 'no guest_id' });
  if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
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
  if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая' });
  if (!Number.isInteger(cell) || cell < 0 || cell >= 25) return sendJSON(res, 400, { error: 'Неверная клетка' });
  if (sess.revealed.includes(cell)) return sendJSON(res, 400, { error: 'Уже открыта' });
  if (sess.finished) return sendJSON(res, 400, { error: 'Завершена' });
  let forceLose = false;
  try { const fp = await pool.query(`SELECT 1 FROM miner_force_lose_players WHERE guest_id=$1`, [guestId]); if (fp.rows.length > 0) forceLose = true; } catch(e) {}
  if (!forceLose) { try { const fr = await pool.query(`SELECT value FROM settings WHERE key='miner_force_lose'`); forceLose = (fr.rows.length && String(fr.rows[0].value) === '1'); } catch(e) {} }
  const isBonusGame = sess.debitResult && sess.debitResult.fromBonus > 0 && sess.debitResult.fromDeposit === 0;
  if (forceLose) {
    sess.finished = true;
    const forcedMines = [cell];
    try {
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', isBonusGame ? 0 : sess.bet, `Miner LOSS (forced) (${guestId})`]);
      await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, 0, forcedMines.length, sess.revealed.length + 1, 0, 'lose', guestId]);
      const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
      if (gName.rows.length) { await accruePointsByNick(gName.rows[0].name, sess.bet, 'miner'); await trackTournamentBet(guestId, gName.rows[0].name, 'miner', sess.bet, 0); }
    } catch(e) {}
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
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', isBonusGame ? 0 : sess.bet, `Miner LOSS (${guestId})`]);
      await pool.query(`INSERT INTO game_history (game, player_name, bet, result, mines, revealed, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, ['miner', guestId, sess.bet, 0, sess.mines.length, sess.revealed.length, 0, 'lose', guestId]);
      const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
      if (gName.rows.length) { await accruePointsByNick(gName.rows[0].name, sess.bet, 'miner'); await trackTournamentBet(guestId, gName.rows[0].name, 'miner', sess.bet, 0); }
    } catch(e) {}
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
      const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
      if (gName.rows.length) await trackTournamentBet(guestId, gName.rows[0].name, 'miner', sess.bet, winAmount);
    } catch(e) {}
    delete minerSessions[sessionId];
    const bal = await getBalance(guestId);
    result.auto_cashout = true; result.win = winAmount; result.mines = sess.mines; result.balance = bal.total; result.deposit_balance = bal.deposit; result.bonus_balance = bal.bonus;
  } else {
    const bal = await getBalance(guestId);
    result.balance = bal.total; result.deposit_balance = bal.deposit; result.bonus_balance = bal.bonus;
  }
  return sendJSON(res, 200, result);
}
if (url === '/api/miner/cashout' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const sessionId = String(b.session_id || '').trim();
  const sess = minerSessions[sessionId];
  if (!sess) return sendJSON(res, 404, { error: 'Сессия не найдена' });
  if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая' });
  if (sess.finished) return sendJSON(res, 400, { error: 'Завершена' });
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
    const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
    if (gName.rows.length) await trackTournamentBet(guestId, gName.rows[0].name, 'miner', sess.bet, winAmount);
  } catch(e) {}
  const bal = await getBalance(guestId);
  const result = { ok: true, win: winAmount, multiplier, bet: sess.bet, mines: sess.mines, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus };
  delete minerSessions[sessionId];
  return sendJSON(res, 200, result);
}

// === ИГРА: PLINKO ===
if (url === '/api/plinko/drop' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
  const risk = String(b.risk || 'low');
  if (!guestId) return sendJSON(res, 400, { error: 'Войдите' });
  if (!PLINKO_MULTIPLIERS[risk]) return sendJSON(res, 400, { error: 'Неверный риск' });
  if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
  const debited = await debitBet(guestId, bet);
  if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
  const pathArr = [];
  for (let i = 0; i < PLINKO_ROWS; i++) pathArr.push(Math.random() < 0.5 ? 0 : 1);
  let slot = pathArr.reduce((a, x) => a + x, 0);
  const multiplier = PLINKO_MULTIPLIERS[risk][slot];
  const winAmount = Math.round(bet * multiplier * 100) / 100;
  if (winAmount > 0) await creditWin(guestId, winAmount, bet);
  try {
    await pool.query(`INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, ['plinko', guestId, bet, winAmount, multiplier, winAmount > bet ? 'win' : 'lose', guestId]);
    const net = bet - winAmount;
    await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Plinko ${risk} (${guestId})`]);
    const gName = await pool.query('SELECT name FROM guests WHERE id=$1', [guestId]);
    if (gName.rows.length) await trackTournamentBet(guestId, gName.rows[0].name, 'plinko', bet, winAmount);
  } catch(e) {}
  const bal = await getBalance(guestId);
  return sendJSON(res, 200, { ok: true, path: pathArr, slot, multiplier, win: winAmount, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
}

// === ИГРА: CASES ===
if (url === '/api/cases/open' && method === 'POST') {
  const b = await parseBody(req);
  const { guest_id, case_name } = b;
  if (!guest_id || !case_name) return sendJSON(res, 400, { error: 'no data' });
  const c = CASES[case_name];
  if (!c) return sendJSON(res, 400, { error: 'Кейс не найден' });
  const g = await pool.query('SELECT * FROM guests WHERE id=$1', [guest_id]);
  if (!g.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
  const guest = g.rows[0];
  const debited = await debitBet(guest.id, c.price);
  if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
  const prize = pickPrize(c.prizes);
  await creditWin(guest.id, prize, c.price);
  await pool.query(`INSERT INTO cases_log (date, guest_id, guest_name, case_name, case_price, prize) VALUES ($1,$2,$3,$4,$5,$6)`, [todayStr(), guest.id, guest.name, case_name, c.price, prize]);
  await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1, $2, $3, $4, NOW(), $5)`, ['cases', guest.name, c.price, prize, guest.id]);
  const net = c.price - prize;
  await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Case ${case_name} (${guest.name})`]);
  const bal = await getBalance(guest.id);
  return sendJSON(res, 200, { ok: true, prize, new_balance: bal.total, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, case_name, price: c.price });
}

// === ИГРА: LADDER ===
if (url === '/api/ladder/start' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const bet = parseFloat(b.bet) || 0;
  const minesCount = parseInt(b.mines, 10) || 1;
  if (!guestId) return sendJSON(res, 400, { error: 'no guest_id' });
  if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
  const debited = await debitBet(guestId, bet);
  if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
  const levelsCount = 13, cellsCount = 20;
  const ladder = [];
  for (let i = 0; i < levelsCount; i++) {
    const mines = [];
    while (mines.length < minesCount) { const r = Math.floor(Math.random() * cellsCount); if (!mines.includes(r)) mines.push(r); }
    ladder.push({ cellsCount, mines });
  }
  const sessionId = 'lad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  ladderSessions[sessionId] = { guestId, bet, minesCount, ladder, currentStep: 0, finished: false, createdAt: Date.now(), debitResult: debited };
  const bal = await getBalance(guestId);
  return sendJSON(res, 200, { ok: true, session_id: sessionId, ladder: ladder.map(l => ({ cellsCount: l.cellsCount, mines: l.mines })), bet, mines: minesCount, levels: levelsCount, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
}
if (url === '/api/ladder/cashout' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId || !ladderSessions[sessionId]) return sendJSON(res, 404, { error: 'Сессия не найдена' });
  const sess = ladderSessions[sessionId];
  if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая' });
  if (sess.finished) return sendJSON(res, 400, { error: 'Завершена' });
  if (sess.currentStep === 0) return sendJSON(res, 400, { error: 'Нет пройденных' });
  const mults = LADDER_MULTS[sess.minesCount];
  const winMult = mults[sess.currentStep - 1];
  const winAmount = Math.round(sess.bet * winMult * 100) / 100;
  sess.finished = true;
  await creditWin(guestId, winAmount, sess.bet);
  try {
    await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1,$2,$3,$4,NOW(),$5)`, ['ladder', guestId, sess.bet, winMult, guestId]);
    await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', winAmount, `Ladder CASHOUT (${guestId})`]);
  } catch(e){}
  const bal = await getBalance(guestId);
  return sendJSON(res, 200, { ok: true, result: 'cashout', win: winAmount, mult: winMult, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
}
if (url === '/api/ladder/step' && method === 'POST') {
  const b = await parseBody(req);
  const guestId = String(b.guest_id || '').trim();
  const sessionId = String(b.session_id || '').trim();
  const cellIdx = parseInt(b.cell, 10);
  if (!sessionId || !ladderSessions[sessionId]) return sendJSON(res, 404, { error: 'Сессия не найдена' });
  const sess = ladderSessions[sessionId];
  if (sess.guestId !== guestId) return sendJSON(res, 403, { error: 'Чужая сессия' });
  if (sess.finished) return sendJSON(res, 400, { error: 'Завершена' });
  if (sess.currentStep >= 13) return sendJSON(res, 400, { error: 'Завершена' });
  if (!Number.isInteger(cellIdx) || cellIdx < 0 || cellIdx >= 20) return sendJSON(res, 400, { error: 'Неверная клетка' });
  const currentLevel = sess.ladder[sess.currentStep];
  if (currentLevel.mines.includes(cellIdx)) {
    sess.finished = true;
    try {
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'доход', sess.bet, `Ladder LOSS (${guestId})`]);
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
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), 'расход', winAmount, `Ladder WIN (${guestId})`]);
    } catch(e){}
    const bal = await getBalance(guestId);
    return sendJSON(res, 200, { ok: true, result: 'win', win: winAmount, mult: winMult, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
  }
  const bal = await getBalance(guestId);
  return sendJSON(res, 200, { ok: true, result: 'safe', next_step: sess.currentStep, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
}
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

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Сервер на порту ' + PORT);
  console.log('  Админ:   /admin.html');
  console.log('');
});
