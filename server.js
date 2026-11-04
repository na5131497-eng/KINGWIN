const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = 'postgresql://neondb_owner:npg_ClW25VuNgUSc@ep-delicate-sea-beqrez4i.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { require: true } });

/* ---------- Конфиг ---------- */
const POINTS_PER_RUB = 0.2;   // 5 ₽ ставки = 1 балл

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

/* ---------- Задания дилеров ---------- */
const DEALER_TASKS = [
  { id: 'bj10',  type: 'bj',  goal: 10,  reward: 15, title: 'Сыграй 10 раундов блэкджека' },
  { id: 'bj30',  type: 'bj',  goal: 30,  reward: 30, title: 'Сыграй 30 раундов блэкджека' },
  { id: 'bj50',  type: 'bj',  goal: 50,  reward: 50, title: 'Сыграй 50 раундов блэкджека' },
  { id: 'bac10', type: 'bac', goal: 10,  reward: 15, title: 'Сыграй 10 раздач баккары' },
  { id: 'bac30', type: 'bac', goal: 30,  reward: 30, title: 'Сыграй 30 раздач баккары' },
  { id: 'bac50', type: 'bac', goal: 50,  reward: 50, title: 'Сыграй 50 раздач баккары' }
];

/* ---------- ГЛОБАЛЬНОЕ СОСТОЯНИЕ КРАША ---------- */
let crashState = {
  status: 'waiting', // waiting, flying, crashed
  startTime: 0,
  crashPoint: 1.00,
  currentMultiplier: 1.00,
  roundId: Date.now(),
  history: [],     // История сыгранных раундов (верхняя лента)
  activeBets: []   // СТАВКИ ТОЛЬКО ТЕКУЩЕГО РАУНДА
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

/* ---------- ИГРОВОЙ ЦИКЛ КРАША ---------- */
async function runCrashGame() {
  while(true) {
    // 1. Стадия ожидания (10 сек)
    crashState.status = 'waiting';
    crashState.currentMultiplier = 1.00;
    crashState.roundId = Date.now();
    crashState.activeBets = []; // <--- ПОЛНАЯ ОЧИСТКА ТАБЛИЦЫ
    
    const r = Math.random();
    if (r < 0.10) crashState.crashPoint = 1.00 + Math.random() * 0.10;
    else if (r < 0.60) crashState.crashPoint = 1.10 + Math.random() * 0.90;
    else if (r < 0.90) crashState.crashPoint = 2.00 + Math.random() * 8.00;
    else crashState.crashPoint = 10.00 + Math.random() * 90.00;

    await new Promise(r => setTimeout(r, 10000));

    // 2. Стадия полета
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

        // Помечаем проигравших в памяти (для тех, кто смотрит)
        crashState.activeBets.forEach(b => {
          if (b.status === 'playing') {
            b.status = 'lose';
            b.multiplier = crashState.crashPoint;
          }
        });

        // Помечаем проигравших в БД (для админа)
        await pool.query(`UPDATE crash_history SET multiplier=$1, status='lose' WHERE status='playing'`, [crashState.crashPoint]);
      } else {
        crashState.currentMultiplier = mult;
      }
      await new Promise(r => setTimeout(r, 100)); 
    }

    // 3. Стадия краша (3 секунды)
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
        balance NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
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
        bonus_text TEXT, bonus_code TEXT,
        pass TEXT DEFAULT '1234',
        bonus_balance NUMERIC DEFAULT 0,
        wagering_required NUMERIC DEFAULT 0,
        wagering_done NUMERIC DEFAULT 0,
        last_rank TEXT DEFAULT 'Bronze',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crash_history (
        id SERIAL PRIMARY KEY, 
        guest_id TEXT, 
        guest_masked TEXT, 
        bet NUMERIC DEFAULT 0, 
        multiplier NUMERIC DEFAULT 0, 
        win_amount NUMERIC DEFAULT 0, 
        status TEXT DEFAULT 'playing',
        created_at TIMESTAMP DEFAULT NOW()
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
      await pool.query(`INSERT INTO employees (name, login, pass, role) VALUES ($1,$2,$3,$4)`,
        ['Владелец', 'Owner', '56UpahoS', 'owner']);
    } else {
      await pool.query(`UPDATE employees SET login = $1, pass = $2 WHERE role = 'owner'`,
        ['Owner', '56UpahoS']);
    }

    const dlCount = await pool.query(`SELECT COUNT(*) FROM dealers`);
    if(parseInt(dlCount.rows[0].count,10) === 0){
      await pool.query(`INSERT INTO dealers (name, login, pass, balance) VALUES ($1,$2,$3,$4)`,
        ['Дилер', 'dealer', '56UpahoS', 0]);
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
    runCrashGame(); // Запускаем игру
  } catch (e) { console.error('Ошибка initDB:', e.message); }
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

async function getDealerTasksProgress(dealerId){
  const day = dayKey(new Date().toISOString().slice(0,10));

  const dRes = await pool.query('SELECT name FROM dealers WHERE id=$1', [dealerId]);
  if(dRes.rows.length === 0) return { day, tasks: [] };
  const dealerName = dRes.rows[0].name;

  const bjRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM sessions WHERE dealer = $1 AND date = $2`,
    [dealerName, day]
  );
  const bacRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM baccarat WHERE dealer = $1 AND date = $2`,
    [dealerName, day]
  );
  const bjCount = bjRes.rows[0]?.cnt || 0;
  const bacCount = bacRes.rows[0]?.cnt || 0;

  const claimedRes = await pool.query(
    `SELECT task_id FROM dealer_tasks_claimed WHERE dealer_id=$1 AND week=$2`,
    [dealerId, day]
  );
  const claimed = new Set(claimedRes.rows.map(r => r.task_id));

  const tasks = DEALER_TASKS.map(t => {
    const progress = t.type === 'bj' ? bjCount : bacCount;
    const done = progress >= t.goal;
    return {
      id: t.id, type: t.type, title: t.title, goal: t.goal,
      reward: t.reward, progress: Math.min(progress, t.goal),
      done, claimed: claimed.has(t.id), canClaim: done && !claimed.has(t.id)
    };
  });

  return { day, tasks };
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

    /* --- КРАШ ИГРА --- */
    if(url === '/api/crash/status' && method === 'GET'){
      // Отдаем статус игры + активные ставки ТЕКУЩЕГО раунда
      return sendJSON(res, 200, {
        ...crashState,
        activeBets: crashState.activeBets 
      });
    }
    
    if(url === '/api/crash/bet' && method === 'POST'){
      if(crashState.status !== 'waiting') return sendJSON(res, 400, { error: 'Прием ставок закрыт' });

      const { id, bet } = await parseBody(req);
      const amt = parseFloat(bet) || 0;
      
      if(!id || amt <= 0) return sendJSON(res, 400, { error: 'Неверная ставка' });

      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'Игрок не найден' });
      const g = r.rows[0];
      
      const balance = parseFloat(g.bonus_balance) || 0;
      if(amt > balance) return sendJSON(res, 400, { error: 'Недостаточно средств' });

      await pool.query('UPDATE guests SET bonus_balance = bonus_balance - $1 WHERE id=$2', [amt, id]);

      const maskedId = g.id.length > 4 ? g.id.slice(0, 2) + '***' + g.id.slice(-2) : '****';
      
      // Добавляем в список АКТИВНЫХ СТАВОК ТЕКУЩЕГО РАУНДА
      crashState.activeBets.push({
        guest_id: g.id,
        guest_masked: maskedId,
        bet: amt,
        multiplier: 0,
        win_amount: 0,
        status: 'playing'
      });

      const c = await pool.query(
        `INSERT INTO crash_history (guest_id, guest_masked, bet, multiplier, win_amount, status) 
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [g.id, maskedId, amt, 0, 0, 'playing']
      );

      return sendJSON(res, 200, { ok: true, crash_id: c.rows[0].id });
    }
    
    if(url === '/api/crash/cashout' && method === 'POST'){
      const { id, crash_id, bet, multiplier } = await parseBody(req);
      const amt = parseFloat(bet) || 0;
      const mult = parseFloat(multiplier) || 1;
      
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'Игрок не найден' });
      
      const winAmount = amt * mult;
      
      await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2', [winAmount, id]);

      // Обновляем в списке активных для текущего раунда
      const activeBet = crashState.activeBets.find(b => b.guest_id === id && b.status === 'playing');
      if(activeBet) {
        activeBet.multiplier = mult;
        activeBet.win_amount = winAmount;
        activeBet.status = 'win';
      }

      if (crash_id) {
        await pool.query(
          `UPDATE crash_history SET multiplier=$1, win_amount=$2, status='win' WHERE id=$3`,
          [mult, winAmount, crash_id]
        );
      }

      return sendJSON(res, 200, { ok: true, winAmount });
    }

    if(url === '/api/crash/history' && method === 'GET'){
      // Этот эндпоинт оставим, он отдает ленту сверху (последние кэфы), если понадобится
      const r = await pool.query(`SELECT * FROM crash_history ORDER BY id DESC LIMIT 50`);
      return sendJSON(res, 200, r.rows);
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
         g.bonus_text || '', g.bonus_code || '', g.pass || '1234']
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
          UPDATE guests SET name=$1, rank=$2, pass=$3, bonus_text=$4, bonus_code=$5, bonus_balance=$6
          WHERE id=$7`, [g.name, g.rank, g.pass, g.bonus_text, g.bonus_code, g.bonus_balance||0, g.id]);
        return sendJSON(res, 200, { ok: true });
      } catch(e){ return sendJSON(res, 500, { error: e.message }); }
    }
    if(url === '/api/guests/withdraw-deduct' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      await pool.query('UPDATE guests SET bonus_balance = GREATEST(0, bonus_balance - $1) WHERE id=$2',
        [parseFloat(sum) || 0, id]);
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
      
      const depRes = await pool.query('SELECT * FROM deposits WHERE id=$1', [id]);
      if(depRes.rows.length === 0) return sendJSON(res, 404, { error: 'Депозит не найден' });
      const dep = depRes.rows[0];

      if(d.status === 'approved' && dep.status !== 'approved') {
        const guestRes = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) LIMIT 1', [dep.nick]);
        if(guestRes.rows.length > 0) {
          const guest = guestRes.rows[0];
          const addSum = parseFloat(dep.sum) || 0;
          await pool.query('UPDATE guests SET bonus_balance = bonus_balance + $1 WHERE id=$2', [addSum, guest.id]);
          await pool.query(
            `INSERT INTO audit (time, user_name, action, details) VALUES ($1,$2,$3,$4)`,
            [new Date().toLocaleString('ru-RU'), 'Система', 'deposit_approved', `Пополнение на ${addSum} ₽ для ${guest.name}`]
          );
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

    /* ВЫВОДЫ ГОСТЕЙ */
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

    /* ВЫПЛАТЫ ДИЛЕРАМ */
    if(url === '/api/payouts' && method === 'GET'){
      const r = await pool.query('SELECT * FROM payouts ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url === '/api/payouts' && method === 'POST'){
      const p = await parseBody(req);
      const r = await pool.query(
        `INSERT INTO payouts (date,dealer,sum,note) VALUES ($1,$2,$3,$4) RETURNING *`,
        [p.date,p.dealer,p.sum,p.note]);
      await pool.query('UPDATE dealers SET balance = balance + $1 WHERE name=$2',
        [parseFloat(p.sum)||0, p.dealer]);
      return sendJSON(res, 200, { ok: true, payout: r.rows[0] });
    }
    if(url.startsWith('/api/payouts/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM payouts WHERE id=$1', [id]);
      return sendJSON(res, 200, { ok: true });
    }

    /* БАЛАНС ДИЛЕРА */
    if(url === '/api/dealer/balance' && method === 'GET'){
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const r = await pool.query('SELECT id,name,login,balance FROM dealers WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const w = await pool.query(
        `SELECT * FROM dealer_withdrawals WHERE dealer_id=$1 ORDER BY id DESC LIMIT 50`, [id]);
      return sendJSON(res, 200, { dealer: r.rows[0], withdrawals: w.rows });
    }
    if(url === '/api/dealer/withdraw' && method === 'POST'){
      const { id, sum } = await parseBody(req);
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const amt = parseFloat(sum) || 0;
      if(amt <= 0) return sendJSON(res, 400, { error: 'Сумма должна быть больше 0' });
      const r = await pool.query('SELECT * FROM dealers WHERE id=$1', [id]);
      if(r.rows.length === 0) return sendJSON(res, 404, { error: 'not found' });
      const d = r.rows[0];
      const bal = parseFloat(d.balance) || 0;
      if(amt > bal) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      await pool.query('UPDATE dealers SET balance = balance - $1 WHERE id=$2', [amt, id]);
      const w = await pool.query(
        `INSERT INTO dealer_withdrawals (date, dealer_id, dealer_name, sum, status, note)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [new Date().toISOString().slice(0,10), d.id, d.name, amt, 'pending', '']);
      return sendJSON(res, 200, { ok: true, withdrawal: w.rows[0] });
    }

    /* ЗАДАНИЯ ДИЛЕРА */
    if(url === '/api/dealer/tasks' && method === 'GET'){
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if(!id) return sendJSON(res, 400, { error: 'no id' });
      const data = await getDealerTasksProgress(parseInt(id,10));
      return sendJSON(res, 200, data);
    }
    if(url === '/api/dealer/tasks/claim' && method === 'POST'){
      const { dealer_id, task_id } = await parseBody(req);
      if(!dealer_id || !task_id) return sendJSON(res, 400, { error: 'no params' });
      const day = dayKey(new Date().toISOString().slice(0,10));
      const data = await getDealerTasksProgress(dealer_id);
      const task = data.tasks.find(t => t.id === task_id);
      if(!task) return sendJSON(res, 400, { error: 'Задание не найдено' });
      if(!task.canClaim) return sendJSON(res, 400, { error: 'Задание ещё не выполнено или уже получено' });
      await pool.query(
        `INSERT INTO dealer_tasks_claimed (dealer_id, task_id, week, reward) VALUES ($1,$2,$3,$4)`,
        [dealer_id, task_id, day, task.reward]);
      await pool.query('UPDATE dealers SET balance = balance + $1 WHERE id=$2',
        [task.reward, dealer_id]);
      return sendJSON(res, 200, { ok: true, reward: task.reward });
    }

    /* ОЦЕНКИ ДИЛЕРОВ */
    if(url === '/api/dealer/rate' && method === 'POST'){
      const { dealer_name, guest_id, guest_name, stars, comment } = await parseBody(req);
      if(!dealer_name || !guest_id) return sendJSON(res, 400, { error: 'no params' });
      const st = parseInt(stars, 10) || 0;
      if(st < 1 || st > 5) return sendJSON(res, 400, { error: 'Оценка от 1 до 5' });
      const r = await pool.query(
        `INSERT INTO dealer_ratings (dealer_name, guest_id, guest_name, stars, comment)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [dealer_name, guest_id, guest_name || '', st, comment || '']);
      return sendJSON(res, 200, { ok: true, rating: r.rows[0] });
    }
    if(url === '/api/dealer/ratings' && method === 'GET'){
      const u = new URL(req.url, 'http://x');
      const name = u.searchParams.get('name');
      let q, params;
      if(name){
        q = `SELECT * FROM dealer_ratings WHERE dealer_name=$1 ORDER BY id DESC LIMIT 100`;
        params = [name];
      } else {
        q = `SELECT * FROM dealer_ratings ORDER BY id DESC LIMIT 200`;
        params = [];
      }
      const r = await pool.query(q, params);
      const agg = await pool.query(
        `SELECT dealer_name, ROUND(AVG(stars)::numeric, 2) AS avg_stars, COUNT(*)::int AS cnt
         FROM dealer_ratings GROUP BY dealer_name ORDER BY avg_stars DESC NULLS LAST`
      );
      return sendJSON(res, 200, { ratings: r.rows, summary: agg.rows });
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
      const r = await pool.query('SELECT id,name,login,balance FROM dealers ORDER BY id');
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

    /* ВЫВОДЫ ДИЛЕРОВ */
    if(url === '/api/dealer-withdrawals' && method === 'GET'){
      const r = await pool.query('SELECT * FROM dealer_withdrawals ORDER BY id DESC');
      return sendJSON(res, 200, r.rows);
    }
    if(url.startsWith('/api/dealer-withdrawals/') && method === 'PUT'){
      const id = url.split('/')[3];
      const w = await parseBody(req);
      await pool.query('UPDATE dealer_withdrawals SET status=$1 WHERE id=$2', [w.status, id]);
      return sendJSON(res, 200, { ok: true });
    }
    if(url.startsWith('/api/dealer-withdrawals/') && method === 'DELETE'){
      const id = url.split('/')[3];
      await pool.query('DELETE FROM dealer_withdrawals WHERE id=$1', [id]);
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
        return sendJSON(res, 200, { ok: true, dealer: {
          id: r.rows[0].id, name: r.rows[0].name, balance: parseFloat(r.rows[0].balance)||0
        }});
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
  console.log('  Сервер запущен');
  console.log('  Сайт:   http://localhost:' + PORT + '/');
  console.log('  Админ:  http://localhost:' + PORT + '/admin.html');
  console.log('  Дилер:  http://localhost:' + PORT + '/dealer.html');
  console.log('  Джекпот: http://localhost:' + PORT + '/jackpot.html');
  console.log('  Краш:   http://localhost:' + PORT + '/crash.html');
  console.log('');
  console.log('  Владелец: Owner / 56UpahoS');
  console.log('  5 ₽ = 1 балл');
  console.log('');
});
