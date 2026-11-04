const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = 'postgresql://neondb_owner:npg_ClW25VuNgUSc@ep-delicate-sea-beqrez4i.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { require: true } });

const loginAttempts = new Map();
const MAX_ATTEMPTS = 3;
const BAN_TIME_MS = 15 * 60 * 1000; 

const requestCounts = new Map();
const MAX_REQUESTS_PER_MINUTE = 100;

const POINTS_PER_RUB = 0.2;   
const ONLINE_POINTS_PER_RUB = 0.1; 

const RANKS = {
  Bronze:   { min: 0,     gift: 0    },
  Silver:   { min: 100,   gift: 50   },
  Gold:     { min: 300,   gift: 200  },
  Platinum: { min: 600,   gift: 500  },
  Diamond:  { min: 1000,  gift: 1000 },
  VIP:      { min: 1500,  gift: 3000 }
};
const RANK_ORDER = ['Bronze','Silver','Gold','Platinum','Diamond','VIP'];

/* ---------- ДЖЕКПОТ (ДО 10 000) ---------- */
const JACKPOT_MAX = 10000;
const JACKPOT_TICK_MS = 5000; // авто-рост каждые 5 секунд
const JACKPOT_PER_TICK = 0.50; // +50 копеек каждые 5 сек

const DEALER_TASKS = [
  { id: 'bj10',  type: 'bj',  goal: 10,  reward: 15, title: 'Сыграй 10 раундов блэкджека' },
  { id: 'bj30',  type: 'bj',  goal: 30,  reward: 30, title: 'Сыграй 30 раундов блэкджека' },
  { id: 'bj50',  type: 'bj',  goal: 50,  reward: 50, title: 'Сыграй 50 раундов блэкджека' },
  { id: 'bac10', type: 'bac', goal: 10,  reward: 15, title: 'Сыграй 10 раздач баккары' },
  { id: 'bac30', type: 'bac', goal: 30,  reward: 30, title: 'Сыграй 30 раздач баккары' },
  { id: 'bac50', type: 'bac', goal: 50,  reward: 50, title: 'Сыграй 50 раздач баккары' }
];

let crashState = {
  status: 'waiting', startTime: 0, crashPoint: 1.00, currentMultiplier: 1.00,
  roundId: Date.now(), history: [], activeBets: [] 
};

function dayKey(dateStr){ return new Date(dateStr).toISOString().slice(0,10); }
function rankByPoints(p){
  if (p >= RANKS.VIP.min)      return 'VIP';
  if (p >= RANKS.Diamond.min)  return 'Diamond';
  if (p >= RANKS.Platinum.min) return 'Platinum';
  if (p >= RANKS.Gold.min)     return 'Gold';
  if (p >= RANKS.Silver.min)   return 'Silver';
  return 'Bronze';
}

function sanitizeString(str, maxLength = 50) {
  if (!str || typeof str !== 'string') return '';
  let cleaned = str.trim().slice(0, maxLength);
  cleaned = cleaned.replace(/<[^>]*>?/gm, '');
  return cleaned;
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
  } catch (e) { console.error('getActualJackpot error:', e.message); return 0; }
}

async function runCrashGame() {
  while(true) {
    crashState.status = 'waiting';
    crashState.currentMultiplier = 1.00;
    crashState.roundId = Date.now();
    crashState.activeBets = []; 
    
    const r = Math.random();
    if (r < 0.13) crashState.crashPoint = 1.00 + Math.random() * 0.10;
    else if (r < 0.65) crashState.crashPoint = 1.10 + Math.random() * 0.90;
    else if (r < 0.93) crashState.crashPoint = 2.00 + Math.random() * 8.00;
    else crashState.crashPoint = 10.00 + Math.random() * 90.00;

    await new Promise(r => setTimeout(r, 10000));

    crashState.status = 'flying';
    crashState.startTime = Date.now();
    
    let isFlying = true;
    while(isFlying) {
      const elapsed = Date.now() - crashState.startTime;
      const mult = Math.pow(1.00006, elapsed);
      
      if (mult >= crashState.crashPoint) {
        crashState.currentMultiplier = crashState.crashPoint;
        crashState.status = 'crashed';
        isFlying = false;
        
        crashState.history.unshift(crashState.crashPoint);
        if(crashState.history.length > 20) crashState.history.pop();

        crashState.activeBets.forEach(b => {
          if (b.status === 'playing') {
            b.status = 'lose';
            b.multiplier = crashState.crashPoint;
          }
        });
        await pool.query(`UPDATE crash_history SET multiplier=$1, status='lose' WHERE status='playing'`, [crashState.crashPoint]);
      } else {
        crashState.currentMultiplier = mult;
      }
      await new Promise(r => setTimeout(r, 100)); 
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

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
        balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_withdrawals (
        id SERIAL PRIMARY KEY, date TEXT, dealer_id INTEGER, dealer_name TEXT,
        sum NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_tasks_claimed (
        id SERIAL PRIMARY KEY, dealer_id INTEGER, task_id TEXT, week TEXT,
        reward NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(dealer_id, task_id, week)
      );
      CREATE TABLE IF NOT EXISTS dealer_ratings (
        id SERIAL PRIMARY KEY, dealer_name TEXT, guest_id TEXT, guest_name TEXT,
        stars INTEGER, comment TEXT, created_at TIMESTAMP DEFAULT NOW()
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
        bonus_text TEXT, bonus_code TEXT, pass TEXT DEFAULT '1234',
        bonus_balance NUMERIC DEFAULT 0, wagering_required NUMERIC DEFAULT 0,
        wagering_done NUMERIC DEFAULT 0, last_rank TEXT DEFAULT 'Bronze',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_history (
        id SERIAL PRIMARY KEY, guest_id TEXT, guest_masked TEXT, bet NUMERIC DEFAULT 0, 
        multiplier NUMERIC DEFAULT 0, win_amount NUMERIC DEFAULT 0, status TEXT DEFAULT 'playing',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS session_rounds (
        id SERIAL PRIMARY KEY, dealer TEXT, date TEXT, round_time TIMESTAMP DEFAULT NOW(),
        game_type TEXT, nick TEXT, bet NUMERIC DEFAULT 0, win NUMERIC DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS jackpot_winners (
        id SERIAL PRIMARY KEY, nick TEXT, amount NUMERIC DEFAULT 0, date TIMESTAMP DEFAULT NOW()
      );
    `);

    const cols = [
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS pass TEXT DEFAULT '1234'`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_required NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS wagering_done NUMERIC DEFAULT 0`,
      `ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_rank TEXT DEFAULT 'Bronze'`,
      `ALTER TABLE dealers ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0`
    ];
    for (const c of cols){ try { await pool.query(c); } catch(e){} }

    const own = await pool.query(`SELECT * FROM employees WHERE role = 'owner'`);
    if(own.rows.length === 0){
      const ownerPass = process.env.OWNER_PASSWORD || '56UpahoS';
      const hashedPass = await bcrypt.hash(ownerPass, 10);
      await pool.query(`INSERT INTO employees (name, login, pass, role) VALUES ($1,$2,$3,$4)`,
        ['Владелец', 'Owner', hashedPass, 'owner']);
    }

    const dlCount = await pool.query(`SELECT COUNT(*) FROM dealers`);
    if(parseInt(dlCount.rows[0].count,10) === 0){
      const dealerPass = process.env.DEALER_PASSWORD || '56UpahoS';
      const hashedPass = await bcrypt.hash(dealerPass, 10);
      await pool.query(`INSERT INTO dealers (name, login, pass, balance) VALUES ($1,$2,$3,$4)`, 
        ['Дилер', 'dealer', hashedPass, 0]);
    }

    const jpCheck = await pool.query(`SELECT * FROM settings WHERE key IN ('jackpot', 'jackpot_last_tick')`);
    if(!jpCheck.rows.find(r => r.key === 'jackpot')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot', '0')`);
    }
    if(!jpCheck.rows.find(r => r.key === 'jackpot_last_tick')){
      await pool.query(`INSERT INTO settings (key, value) VALUES ('jackpot_last_tick', $1)`, [Date.now().toString()]);
    }

    console.log('База готова');
    runCrashGame();
  } catch (e) { console.error('Ошибка initDB:', e.message); }
}
initDB();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
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

  let giftMoney = 0, giftText = guest.bonus_text || '', giftCode = guest.bonus_code || '';
  const prevIdx = RANK_ORDER.indexOf(prevRank), newIdx = RANK_ORDER.indexOf(newRank);
  if (newIdx > prevIdx){
    for (let i = prevIdx + 1; i <= newIdx; i++) giftMoney += RANKS[RANK_ORDER[i]].gift;
    giftText = `Поздравляем с достижением ранга ${newRank}! Вам подарок ${giftMoney} бонусных рублей.`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }
  const addWagerReq = giftMoney * 5, addWagerDone = addPoints;

  await pool.query(`
    UPDATE guests SET points = $1, rank = $2, last_rank = $3, bonus_text = $4, bonus_code = $5, 
      bonus_balance = bonus_balance + $6, wagering_required = wagering_required + $7, wagering_done = wagering_done + $8 WHERE id = $9
  `, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReq, addWagerDone, guest.id]);
  return { guestId: guest.id, addPoints, newPoints, newRank, giftMoney, source };
}

async function accruePointsOnline(guestId, rubAmount){
  if(!guestId || !rubAmount || rubAmount <= 0) return;
  const g = await pool.query(`SELECT * FROM guests WHERE id=$1`, [guestId]);
  if(g.rows.length === 0) return;
  const guest = g.rows[0];
  const addPoints = Math.floor(rubAmount * ONLINE_POINTS_PER_RUB);
  if(addPoints <= 0) return;

  const newPoints = (guest.points || 0) + addPoints;
  const prevRank = guest.rank || 'Bronze';
  const newRank = rankByPoints(newPoints);

  let giftMoney = 0, giftText = guest.bonus_text || '', giftCode = guest.bonus_code || '';
  const prevIdx = RANK_ORDER.indexOf(prevRank), newIdx = RANK_ORDER.indexOf(newRank);
  if (newIdx > prevIdx){
    for (let i = prevIdx + 1; i <= newIdx; i++) giftMoney += RANKS[RANK_ORDER[i]].gift;
    giftText = `Поздравляем с достижением ранга ${newRank}! Вам подарок ${giftMoney} бонусных рублей.`;
    giftCode = `GIFT-${newRank.toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  }
  const addWagerReq = giftMoney * 5;
  
  await pool.query(`
    UPDATE guests SET points = $1, rank = $2, last_rank = $3, bonus_text = $4, bonus_code = $5, 
      bonus_balance = bonus_balance + $6, wagering_required = wagering_required + $7 WHERE id = $8
  `, [newPoints, newRank, newRank, giftText, giftCode, giftMoney, addWagerReq, guest.id]);
}

async function getDealerTasksProgress(dealerId){
  const day = dayKey(new Date().toISOString().slice(0,10));
  const dRes = await pool.query('SELECT name FROM dealers WHERE id=$1', [dealerId]);
  if(dRes.rows.length === 0) return { day, tasks: [] };
  const dealerName = dRes.rows[0].name;
  
  const bjRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM session_rounds WHERE dealer = $1 AND game_type = 'bj' AND date = $2`, [dealerName, day]);
  const bacRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM session_rounds WHERE dealer = $1 AND game_type = 'bac' AND date = $2`, [dealerName, day]);
  const bjCount = bjRes.rows[0]?.cnt || 0, bacCount = bacRes.rows[0]?.cnt || 0;
  
  const claimedRes = await pool.query(`SELECT task_id FROM dealer_tasks_claimed WHERE dealer_id=$1 AND week=$2`, [dealerId, day]);
  const claimed = new Set(claimedRes.rows.map(r => r.task_id));
  
  const tasks = DEALER_TASKS.map(t => {
    const progress = t.type === 'bj' ? bjCount : bacCount;
    const done = progress >= t.goal;
    return { id: t.id, type: t.type, title: t.title, goal: t.goal, reward: t.reward, progress: Math.min(progress, t.goal), done, claimed: claimed.has(t.id), canClaim: done && !claimed.has(t.id) };
  });
  return { day, tasks };
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  let reqData = requestCounts.get(ip);
  if (!reqData || now > reqData.resetTime) {
    reqData = { count: 0, resetTime: now + 60000 }; 
  }
  reqData.count++;
  
  if (url.startsWith('/api/crash/status')) {
    reqData.count = Math.max(0, reqData.count - 1);
  }
  
  requestCounts.set(ip, reqData);

  if (reqData.count > MAX_REQUESTS_PER_MINUTE) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Слишком много запросов. Подождите немного.' }));
  }

  try {
    if(url === '/api/jackpot' && method === 'GET'){
      const jackpot = await getActualJackpot();
      return sendJSON(res, 200, { jackpot });
    }

    /* --- ДЖЕКПОТ ВЫИГРАН --- */
    if(url === '/api/jackpot/win' && method === 'POST'){
      const { nick, amount } = await parseBody(req);
      const safeNick = sanitizeString(nick, 50);
      const amt = parseFloat(amount) || 0;
      
      if(!safeNick || amt <= 0) return sendJSON(res, 400, { error: 'Неверные данные' });
      
      // Записываем победителя
      await pool.query(`INSERT INTO jackpot_winners (nick, amount) VALUES ($1, $2)`, [safeNick, amt]);
      
      // Сбрасываем джекпот в 0
      await pool.query(`UPDATE settings SET value = '0' WHERE key = 'jackpot'`);
      await pool.query(`UPDATE settings SET value = $1 WHERE key = 'jackpot_last_tick'`, [Date.now().toString()]);
      
      return sendJSON(res, 200, { ok: true });
    }

    /* --- ИСТОРИЯ ДЖЕКПОТА --- */
    if(url === '/api/jackpot/winners' && method === 'GET'){
      const r = await pool.query(`SELECT * FROM jackpot_winners ORDER BY id DESC LIMIT 10`);
      return sendJSON(res, 200, r.rows);
    }

    /* --- РАУНД --- */
    if(url === '/api/sessions/round' && method === 'POST'){
      const { dealer, game_type, nick, bet, win } = await parseBody(req);
      
      const safeNick = sanitizeString(nick, 50);
      if(!dealer || !safeNick) return sendJSON(res, 400, { error: 'Нет данных' });
      
      const betAmt = parseFloat(bet) || 0;
      const winAmt = parseFloat(win) || 0;
      
      if (betAmt > 10000) return sendJSON(res, 400, { error: 'Ставка не может быть больше 10 000 ₽' });
      if (winAmt > 100000) return sendJSON(res, 400, { error: 'Выигрыш не может быть больше 100 000 ₽' });
      
      const lastRound = await pool.query(`SELECT round_time FROM session_rounds WHERE dealer = $1 ORDER BY id DESC LIMIT 1`, [dealer]);
      if (lastRound.rows.length > 0) {
        const lastTime = new Date(lastRound.rows[0].round_time).getTime();
        if (Date.now() - lastTime < 3000) {
          return sendJSON(res, 429, { error: 'Слишком быстро. Подождите 3 секунды.' });
        }
      }

      const today = new Date().toISOString().slice(0,10);
      
      await pool.query(
        `INSERT INTO session_rounds (dealer, date, game_type, nick, bet, win) VALUES ($1,$2,$3,$4,$5,$6)`,
        [dealer, today, game_type, safeNick, betAmt, winAmt]
      );

      if (betAmt > 0) {
        await accruePointsByNick(safeNick, betAmt, game_type);
        // ДЖЕКПОТ РАСТЕТ ОТ СТАВОК (10% ОТ ДЕПОЗИТА)
        const jpAdd = betAmt * 0.10;
        let currentJP = await getActualJackpot();
        currentJP += jpAdd;
        if (currentJP >= JACKPOT_MAX) currentJP = 0;
        await pool.query(`UPDATE settings SET value = $1 WHERE key = 'jackpot'`, [currentJP.toString()]);
        await pool.query(`UPDATE settings SET value = $1 WHERE key = 'jackpot_last_tick'`, [Date.now().toString()]);
      }

      return sendJSON(res, 200, { ok: true, bet: betAmt, win: winAmt });
    }

    if(url === '/api/sessions/rounds' && method === 'GET'){
      const r = await pool.query(`SELECT * FROM session_rounds ORDER BY id DESC LIMIT 500`);
      return sendJSON(res, 200, r.rows);
    }

    /* --- КРАШ --- */
    if(url === '/api/crash/status' && method === 'GET'){
      return sendJSON(res, 200, { ...crashState, activeBets: crashState.activeBets });
    }
    
    if(url === '/api/crash/bet' && method === 'POST'){
      if(crashState.status !== 'waiting') return sendJSON(res, 400, { error: 'Прием ставок закрыт' });
      const { id, bet } = await parseBody(req);
      const amt = parseFloat(bet) || 0;
      
      if(!id || amt < 1 || amt > 1000) {
        return sendJSON(res, 400, { error: 'Ставка от 1 до 1000 ₽' });
      }
      
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const g = r.rows[0];
      if(amt > (parseFloat(g.bonus_balance) || 0)) return sendJSON(res, 400, { error: 'Недостаточно средств' });

      await pool.query('UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2', [amt, id]);
      await accruePointsOnline(g.id, amt);
      const maskedId = g.id.length > 4 ? g.id.slice(0, 2) + '***' + g.id.slice(-2) : '****';
      
      crashState.activeBets.push({ guest_id: g.id, guest_masked: maskedId, bet: amt, multiplier: 0, win_amount: 0, status: 'playing' });
      const c = await pool.query(`INSERT INTO crash_history (guest_id, guest_masked, bet, multiplier, win_amount, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [g.id, maskedId, amt, 0, 0, 'playing']);
      return sendJSON(res, 200, { ok: true, crash_id: c.rows[0].id });
    }
    
    if(url === '/api/crash/cashout' && method === 'POST'){
      if (crashState.status !== 'flying') {
        return sendJSON(res, 400, { error: 'Раунд уже закончился (Краш)' });
      }

      const { id, crash_id } = await parseBody(req);
      
      const activeBet = crashState.activeBets.find(b => b.guest_id === id && b.status === 'playing');
      if (!activeBet) return sendJSON(res, 400, { error: 'Активная ставка не найдена' });

      const currentMult = crashState.currentMultiplier;
      const winAmount = activeBet.bet * currentMult;
      
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2', [winAmount, id]);
      
      activeBet.multiplier = currentMult;
      activeBet.win_amount = winAmount;
      activeBet.status = 'win';

      if (crash_id) {
        await pool.query(`UPDATE crash_history SET multiplier=$1, win_amount=$2, status='win' WHERE id=$3`, [currentMult, winAmount, crash_id]);
      }

      return sendJSON(res, 200, { ok: true, winAmount, multiplier: currentMult });
    }

    /* ГОСТИ */
    if(url === '/api/guests' && method === 'GET'){
      const r = await pool.query('SELECT * FROM guests ORDER BY id');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/guests' && method === 'POST'){
      const g = await parseBody(req);
      const safeName = sanitizeString(g.name, 50);
      if (!safeName) return sendJSON(res, 400, { error: 'Некорректное имя' });
      const safeBonusText = sanitizeString(g.bonus_text || '', 100);
      const safeBonusCode = sanitizeString(g.bonus_code || '', 30);

      const cardId = g.id || Math.floor(10000000 + Math.random() * 90000000).toString();
      const hashedPass = await bcrypt.hash(String(g.pass || '1234').slice(0, 30), 10);
      const r = await pool.query(
        `INSERT INTO guests (id, name, rank, points, visits, bonus_text, bonus_code, pass)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [cardId, safeName, g.rank || 'Bronze', g.points || 0, g.visits || 0, safeBonusText, safeBonusCode, hashedPass]
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
      const safeName = sanitizeString(g.name, 50);
      if (!safeName) return sendJSON(res, 400, { error: 'Некорректное имя' });
      const safeBonusText = sanitizeString(g.bonus_text || '', 100);
      const safeBonusCode = sanitizeString(g.bonus_code || '', 30);
      
      try {
        if (g.pass) {
          const hashedPass = await bcrypt.hash(String(g.pass).slice(0, 30), 10);
          await pool.query(`UPDATE guests SET name=$1, rank=$2, pass=$3, bonus_text=$4, bonus_code=$5, bonus_balance=$6 WHERE id=$7`, 
            [safeName, g.rank, hashedPass, safeBonusText, safeBonusCode, g.bonus_balance||0, g.id]);
        } else {
          await pool.query(`UPDATE guests SET name=$1, rank=$2, bonus_text=$3, bonus_code=$4, bonus_balance=$5 WHERE id=$6`, 
            [safeName, g.rank, safeBonusText, safeBonusCode, g.bonus_balance||0, g.id]);
        }
        return sendJSON(res, 200, { ok: true });
      } catch(e){ return sendJSON(res, 500, { error: e.message }); }
    }
    if(url === '/api/guests/withdraw-deduct' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      await pool.query('UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2', [parseFloat(sum) || 0, id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ЛОГИН ГОСТЯ */
    if(url === '/api/guest/login' && method === 'POST'){
      const attempt = loginAttempts.get(ip) || { count: 0, banUntil: 0 };
      if (attempt.banUntil > Date.now()) {
        const minutesLeft = Math.ceil((attempt.banUntil - Date.now()) / 60000);
        return sendJSON(res, 429, { error: `Слишком много попыток. Подождите ${minutesLeft} мин.` });
      }

      const { id, pass } = await parseBody(req);
      if(!id || !pass) return sendJSON(res, 400, { error: 'Введите номер карты и пароль' });
      
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [String(id).trim()]);
      if(r.rows.length === 0) {
        attempt.count += 1;
        if (attempt.count >= MAX_ATTEMPTS) { attempt.banUntil = Date.now() + BAN_TIME_MS; attempt.count = 0; }
        loginAttempts.set(ip, attempt);
        return sendJSON(res, 401, { error: 'Карта не найдена' });
      }
      
      const g = r.rows[0];
      const match = await bcrypt.compare(String(pass), g.pass);
      
      if(!match) {
        attempt.count += 1;
        if (attempt.count >= MAX_ATTEMPTS) { attempt.banUntil = Date.now() + BAN_TIME_MS; attempt.count = 0; }
        loginAttempts.set(ip, attempt);
        return sendJSON(res, 401, { error: 'Неверный пароль' });
      }
      
      loginAttempts.delete(ip);
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
      
      if (parseFloat(g.wagering_done) < parseFloat(g.wagering_required)) return sendJSON(res, 400, { error: 'Сначала выполните условие (отыгрыш)' });
      if (amt > (parseFloat(g.bonus_balance) || 0)) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2', [amt, id]);
      const w = await pool.query(
        `INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [new Date().toISOString().slice(0,10), g.name, '', amt, 0, amt, 'pending']
      );
      return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] });
    }

    /* ДЕПОЗИТЫ */
    if(url === '/api/deposits' && method === 'GET'){
      const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/deposits' && method === 'POST'){
      const d = await parseBody(req);
      const r = await pool.query(`INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [d.date,d.nick,d.email,d.sum,d.status||'pending']);
      return sendJSON(res, 200, { ok: true, deposit: r.rows[0] });
    }
    if(url.startsWith('/api/deposits/') && method === 'PUT'){
      const id = url.split('/')[3];
      const d = await parseBody(req);
      const depRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if(depRes.rows.length === 0) return sendJSON(res, 404, { error: 'Депозит не найден' });
      const dep = depRes.rows[0];

      if(d.status === 'approved' && dep.status !== 'approved') {
        const guestRes = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [dep.nick]);
        if(guestRes.rows.length > 0) {
          await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2', [parseFloat(dep.sum) || 0, guestRes.rows[0].id]);
          await pool.query(`INSERT INTO audit (time, user_name, action, details) VALUES ($1,$2,$3,$4)`, [new Date().toLocaleString('ru-RU'), 'Система', 'deposit_approved', `Пополнение на ${dep.sum} ₽ для ${guestRes.rows[0].name}`]);
        }
      }
      await pool.query('UPDATE deposits SET status=$1 WHERE id=$2', [d.status, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/deposits/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM deposits WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    if(url === '/api/withdrawals' && method === 'GET'){
      const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/withdrawals' && method === 'POST'){
      const w = await parseBody(req);
      const r = await pool.query(`INSERT INTO withdrawals (date,nick,email,sum,fee,net,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [w.date,w.nick,w.email,w.sum,w.fee,w.net,w.status||'pending']);
      return sendJSON(res, 200, { ok: true, withdrawal: r.rows[0] });
    }
    if(url.startsWith('/api/withdrawals/') && method === 'PUT'){
      const id = url.split('/')[3];
      const w = await parseBody(req);
      
      if(w.status === 'rejected') {
        const wrRes = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
        if(wrRes.rows.length > 0 && wrRes.rows[0].status === 'pending') {
          const wr = wrRes.rows[0];
          const guestRes = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [wr.nick]);
          if(guestRes.rows.length > 0) {
            await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2', [parseFloat(wr.sum) || 0, guestRes.rows[0].id]);
          }
        }
      }
      
      await pool.query('UPDATE withdrawals SET status=$1 WHERE id=$2', [w.status, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/withdrawals/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM withdrawals WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* ЛОГИН (АДМИН/ДИЛЕР) */
    if(url === '/api/login' && method === 'POST'){
      const attempt = loginAttempts.get(ip) || { count: 0, banUntil: 0 };
      if (attempt.banUntil > Date.now()) {
        const minutesLeft = Math.ceil((attempt.banUntil - Date.now()) / 60000);
        return sendJSON(res, 429, { error: `Слишком много попыток. Подождите ${minutesLeft} мин.` });
      }

      const { login, pass, type } = await parseBody(req);
      let isSuccess = false;
      let responseData = null;
      
      if(type === 'dealer'){
        const r = await pool.query('SELECT * FROM dealers WHERE login=$1', [login]);
        if(r.rows.length > 0){
          const d = r.rows[0];
          const match = await bcrypt.compare(String(pass), d.pass);
          if(match) {
            isSuccess = true;
            responseData = { ok: true, dealer: { id: d.id, name: d.name, balance: parseFloat(d.balance)||0 } };
          }
        }
      } else {
        const r = await pool.query('SELECT * FROM employees WHERE login=$1', [login]);
        if(r.rows.length > 0){
          const e = r.rows[0];
          const match = await bcrypt.compare(String(pass), e.pass);
          if(match) {
            isSuccess = true;
            responseData = { ok: true, employee: { id: e.id, name: e.name, role: e.role } };
          }
        }
      }

      if (isSuccess) {
        loginAttempts.delete(ip); 
        return sendJSON(res, 200, responseData);
      } else {
        attempt.count += 1;
        if (attempt.count >= MAX_ATTEMPTS) {
          attempt.banUntil = Date.now() + BAN_TIME_MS;
          attempt.count = 0; 
        }
        loginAttempts.set(ip, attempt);
        return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
      }
    }

    /* СОТРУДНИКИ */
    if(url === '/api/employees' && method === 'GET'){ const r = await pool.query('SELECT id,name,login,role FROM employees ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/employees' && method === 'POST'){
      const e = await parseBody(req);
      try {
        const hashedPass = await bcrypt.hash(e.pass, 10);
        const r = await pool.query(`INSERT INTO employees (name,login,pass,role) VALUES ($1,$2,$3,$4) RETURNING id,name,login,role`, [e.name,e.login,hashedPass,e.role]);
        return sendJSON(res, 200, { ok: true, employee: r.rows[0] });
      } catch(err){ return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if(url.startsWith('/api/employees/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM employees WHERE id=$1 AND role!=$2', [id, 'owner']); return sendJSON(res, 200, { ok: true }); }

    /* ДИЛЕРЫ */
    if(url === '/api/dealers' && method === 'GET'){ const r = await pool.query('SELECT id,name,login,balance FROM dealers ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/dealers' && method === 'POST'){
      const d = await parseBody(req);
      try {
        const hashedPass = await bcrypt.hash(d.pass, 10);
        const r = await pool.query(`INSERT INTO dealers (name,login,pass) VALUES ($1,$2,$3) RETURNING id,name,login`, [d.name,d.login,hashedPass]);
        return sendJSON(res, 200, { ok: true, dealer: r.rows[0] });
      } catch(err){ return sendJSON(res, 400, { error: 'Логин занят' }); }
    }
    if(url.startsWith('/api/dealers/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM dealers WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    /* ОСТАЛЬНОЕ */
    if(url === '/api/payouts' && method === 'GET'){ const r = await pool.query('SELECT * FROM payouts ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/payouts' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(`INSERT INTO payouts (date,dealer,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`, [p.date,p.dealer,p.sum,p.note]);
      await pool.query('UPDATE dealers SET balance = balance + $1 WHERE name=$2', [parseFloat(p.sum)||0, p.dealer]);
      return sendJSON(res, 200, { ok: true, payout: r.rows[0] });
    }
    if(url.startsWith('/api/payouts/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM payouts WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
    if(url === '/api/players' && method === 'GET'){ const r = await pool.query('SELECT * FROM players ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/players' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(`INSERT INTO players (nick,vip,blocked) VALUES ($1,$2,$3) ON CONFLICT (nick) DO UPDATE SET vip=EXCLUDED.vip, blocked=EXCLUDED.blocked RETURNING *`, [p.nick,p.vip||false,p.blocked||false]);
      return sendJSON(res, 200, { ok: true, player: r.rows[0] });
    }
    if(url === '/api/games' && method === 'GET'){ const r = await pool.query('SELECT * FROM games ORDER BY id'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/games' && method === 'POST'){ const g = await parseBody(req); const r = await pool.query(`INSERT INTO games (name,provider,min_sum,max_sum,active) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [g.name,g.provider,g.min,g.max,true]); return sendJSON(res, 200, { ok: true, game: r.rows[0] }); }
    if(url.startsWith('/api/games/') && method === 'PUT'){ const id = url.split('/')[3]; const g = await parseBody(req); await pool.query('UPDATE games SET active=$1 WHERE id=$2', [g.active, id]); return sendJSON(res, 200, { ok: true }); }
    if(url.startsWith('/api/games/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM games WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
    if(url === '/api/audit' && method === 'GET'){ const r = await pool.query('SELECT * FROM audit ORDER BY id DESC LIMIT 500'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/audit' && method === 'POST'){ const a = await parseBody(req); const r = await pool.query(`INSERT INTO audit (time,user_name,action,details) VALUES ($1,$2,$3,$4) RETURNING *`, [a.time,a.user,a.action,a.details]); return sendJSON(res, 200, { ok: true, audit: r.rows[0] }); }
    if(url === '/api/audit' && method === 'DELETE'){ await pool.query('DELETE FROM audit'); return sendJSON(res, 200, { ok: true }); }
    if(url === '/api/dealer/balance' && method === 'GET'){ const u = new URL(req.url, 'http://x'); const id = u.searchParams.get('id'); const r = await pool.query('SELECT id,name,login,balance FROM dealers WHERE id=$1', [id]); const w = await pool.query(`SELECT * FROM dealer_withdrawals WHERE dealer_id=$1 ORDER BY id DESC LIMIT 50`, [id]); return sendJSON(res, 200, { dealer: r.rows[0], withdrawals: w.rows }); }
    if(url === '/api/dealer/withdraw' && method === 'POST'){ const { id, sum } = await parseBody(req); const amt = parseFloat(sum) || 0; const r = await pool.query('SELECT * FROM dealers WHERE id=$1', [id]); const d = r.rows[0]; if(amt > (parseFloat(d.balance)||0)) return sendJSON(res, 400, { error: 'Недостаточно средств' }); await pool.query('UPDATE dealers SET balance = balance - $1 WHERE id=$2', [amt, id]); const w = await pool.query(`INSERT INTO dealer_withdrawals (date, dealer_id, dealer_name, sum, status, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [new Date().toISOString().slice(0,10), d.id, d.name, amt, 'pending', '']); return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] }); }
    if(url === '/api/dealer/tasks' && method === 'GET'){ const u = new URL(req.url, 'http://x'); const data = await getDealerTasksProgress(parseInt(u.searchParams.get('id'),10)); return sendJSON(res, 200, data); }
    if(url === '/api/dealer/tasks/claim' && method === 'POST'){ const { dealer_id, task_id } = await parseBody(req); const day = dayKey(new Date().toISOString().slice(0,10)); const data = await getDealerTasksProgress(dealer_id); const task = data.tasks.find(t => t.id === task_id); if(!task || !task.canClaim) return sendJSON(res, 400, { error: 'Ошибка' }); await pool.query(`INSERT INTO dealer_tasks_claimed (dealer_id, task_id, week, reward) VALUES ($1,$2,$3,$4)`, [dealer_id, task_id, day, task.reward]); await pool.query('UPDATE dealers SET balance = balance + $1 WHERE id=$2', [task.reward, dealer_id]); return sendJSON(res, 200, { ok: true, reward: task.reward }); }
    if(url === '/api/dealer/rate' && method === 'POST'){ const { dealer_name, guest_id, guest_name, stars, comment } = await parseBody(req); const r = await pool.query(`INSERT INTO dealer_ratings (dealer_name, guest_id, guest_name, stars, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [dealer_name, guest_id, guest_name || '', parseInt(stars,10), comment || '']); return sendJSON(res, 200, { ok: true, rating: r.rows[0] }); }
    if(url === '/api/dealer/ratings' && method === 'GET'){ const r = await pool.query(`SELECT * FROM dealer_ratings ORDER BY id DESC LIMIT 200`); const agg = await pool.query(`SELECT dealer_name, ROUND(AVG(stars)::numeric, 2) AS avg_stars, COUNT(*)::int AS cnt FROM dealer_ratings GROUP BY dealer_name ORDER BY avg_stars DESC NULLS LAST`); return sendJSON(res, 200, { ratings: r.rows, summary: agg.rows }); }
    if(url === '/api/dealer-withdrawals' && method === 'GET'){ const r = await pool.query('SELECT * FROM dealer_withdrawals ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if(url.startsWith('/api/dealer-withdrawals/') && method === 'PUT'){ const id = url.split('/')[3]; const w = await parseBody(req); await pool.query('UPDATE dealer_withdrawals SET status=$1 WHERE id=$2', [w.status, id]); return sendJSON(res, 200, { ok: true }); }
    if(url.startsWith('/api/dealer-withdrawals/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM dealer_withdrawals WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }
    if(url === '/api/online' && method === 'GET'){ const r = await pool.query('SELECT * FROM online ORDER BY id DESC'); return sendJSON(res, 200, r.rows); }
    if(url === '/api/online' && method === 'POST'){ const o = await parseBody(req); const r = await pool.query(`INSERT INTO online (date,type,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`, [o.date,o.type,o.sum,o.note]); return sendJSON(res, 200, { ok: true, online: r.rows[0] }); }
    if(url.startsWith('/api/online/') && method === 'DELETE'){ const id = url.split('/')[3]; await pool.query('DELETE FROM online WHERE id=$1', [id]); return sendJSON(res, 200, { ok: true }); }

    /* СТАТИКА */
    let file = url === '/' ? '/index.html' : url;
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);

  } catch (e) {
    console.error('Ошибка сервера:', e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Сервер запущен');
});
