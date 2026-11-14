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

pool.on('error', (err) => console.error('PG Pool error:', err.message));

function todayStr(){ return new Date().toISOString().slice(0, 10); }

// --- ИНИЦИАЛИЗАЦИЯ БАЗЫ ---
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'deposit_bonus',
        value NUMERIC DEFAULT 0, min_deposit NUMERIC DEFAULT 0, max_uses INT DEFAULT 1,
        used_count INT DEFAULT 0, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS active_bonuses (
        id SERIAL PRIMARY KEY, guest_id TEXT NOT NULL, promo_id INT, title TEXT DEFAULT 'Бонус',
        amount NUMERIC DEFAULT 0, min_deposit NUMERIC DEFAULT 0, wager_multiplier NUMERIC DEFAULT 5,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealers (
        id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pass TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dealer_daily (
        id SERIAL PRIMARY KEY, dealer_id INTEGER, date TEXT, hands INTEGER DEFAULT 0, UNIQUE(dealer_id, date)
      );
      CREATE TABLE IF NOT EXISTS roulette_sessions (
        id SERIAL PRIMARY KEY, dealer TEXT, nick TEXT, bet_type TEXT, bet NUMERIC DEFAULT 0, win NUMERIC DEFAULT 0,
        won INTEGER DEFAULT 0, date TEXT, result_number INTEGER, result_color TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const dlCheck = await pool.query(`SELECT * FROM dealers WHERE login = 'dealer'`);
    if (dlCheck.rows.length === 0) {
      await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1, $2, $3)`, ['Дилер', 'dealer', '56UpahoS']);
    }
    console.log('База готова');
  } catch (e) {
    console.error('Ошибка initDB:', e.message);
    setTimeout(initDB, 5000);
  }
}
initDB();

// --- ИГРОВАЯ МАТЕМАТИКА ---
const CASES = {
  'Новичок': { price: 39.99, prizes: [{ v:10, w:42000 }, { v:15, w:24000 }, { v:25, w:13000 }, { v:50, w:8500 }, { v:100, w:5500 }, { v:115, w:3200 }, { v:200, w:1800 }, { v:250, w:900 }, { v:500, w:500 }, { v:650, w:300 }, { v:1000, w:50 }]},
  'Сильвер': { price: 199, prizes: [{ v:10,w:1500 },{ v:20,w:2000 },{ v:50,w:2500 },{ v:80,w:2000 },{ v:120,w:1000 },{ v:200,w:600 },{ v:300,w:200 },{ v:500,w:100 },{ v:1000,w:50 },{ v:1500,w:30 },{ v:2000,w:15 }]},
  'Голд': { price: 399, prizes: [{ v:20,w:1500 },{ v:50,w:2000 },{ v:100,w:2500 },{ v:150,w:2000 },{ v:250,w:1000 },{ v:400,w:600 },{ v:600,w:200 },{ v:1000,w:100 },{ v:2000,w:50 },{ v:3000,w:15 }]},
  'Платина': { price: 899, prizes: [{ v:50,w:1500 },{ v:100,w:2000 },{ v:200,w:2500 },{ v:350,w:2000 },{ v:500,w:1000 },{ v:900,w:600 },{ v:1500,w:200 },{ v:2500,w:100 },{ v:4000,w:50 }]},
  'Королевский': { price: 4999, prizes: [{ v:200,w:1500 },{ v:500,w:2000 },{ v:1000,w:2500 },{ v:2000,w:2000 },{ v:3500,w:1000 },{ v:5000,w:600 },{ v:10000,w:200 }]}
};
function pickPrize(prizes) {
  const total = prizes.reduce((a,p) => a + p.w, 0);
  let r = Math.random() * total;
  for (const p of prizes) { if (r < p.w) return p.v; r -= p.w; }
  return prizes[prizes.length - 1].v;
}

const PLINKO_ROWS = 8;
const PLINKO_MULTIPLIERS = {
  low: [1.9, 1.4, 1.1, 0.9, 0.5, 0.9, 1.1, 1.4, 1.9],
  medium: [5.0, 2.0, 1.0, 0.5, 0.2, 0.5, 1.0, 2.0, 5.0],
  high: [10.0, 3.0, 0.8, 0.2, 0.1, 0.2, 0.8, 3.0, 10.0]
};

const LADDER_MULTS = {
  1: [1.05, 1.10, 1.16, 1.22, 1.29, 1.36, 1.44, 1.53, 1.63, 1.74, 1.86, 2.00, 2.15],
  2: [1.11, 1.25, 1.41, 1.59, 1.80, 2.04, 2.32, 2.65, 3.03, 3.49, 4.03, 4.68, 5.45],
  3: [1.18, 1.42, 1.70, 2.06, 2.50, 3.06, 3.75, 4.62, 5.72, 7.14, 8.97, 11.34, 14.45],
  4: [1.25, 1.61, 2.07, 2.70, 3.53, 4.66, 6.20, 8.33, 11.33, 15.61, 21.83, 30.98, 44.60],
  5: [1.33, 1.82, 2.51, 3.50, 4.94, 7.07, 10.27, 15.16, 22.80, 35.04, 55.02, 88.34, 145.60],
  6: [1.40, 2.05, 3.02, 4.51, 6.84, 10.57, 16.69, 27.04, 45.07, 77.79, 139.76, 263.78, 523.93],
  7: [1.47, 2.32, 3.69, 5.96, 9.85, 16.78, 29.62, 54.58, 105.62, 216.05, 471.43, 1102.24, 2783.50]
};

// --- ЛОГИКА БАЛАНСА И ВЕЙДЖЕРА ---
async function debitBet(guestId, amount) {
  const r = await pool.query('SELECT bonus_balance, deposit_balance FROM guests WHERE id=$1', [guestId]);
  if (!r.rows.length) return null;
  let bonus = parseFloat(r.rows[0].bonus_balance) || 0;
  let dep = parseFloat(r.rows[0].deposit_balance) || 0;
  if (bonus + dep < amount) return null;
  let rem = amount, fromBonus = 0, fromDeposit = 0;
  if (bonus >= rem) { fromBonus = rem; bonus -= rem; rem = 0; }
  else { fromBonus = bonus; rem -= bonus; bonus = 0; fromDeposit = rem; dep -= rem; }
  await pool.query('UPDATE guests SET bonus_balance=$1, deposit_balance=$2 WHERE id=$3', [bonus, dep, guestId]);
  return { fromBonus, fromDeposit };
}

async function creditWin(guestId, winAmount, betAmount) {
  if (winAmount <= 0) return;
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
        await pool.query(`UPDATE guests SET deposit_balance = deposit_balance + $1, bonus_balance = 0, wagering_required = 0, wagering_done = 0 WHERE id = $2`, [cashback, guestId]);
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

// --- СЕРВЕР И API ---
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  // Исправленная функция sendJSON (без бага статус-кода)
  const sendJSON = (resObj, code, data) => {
    try {
      if (resObj.headersSent) return;
      resObj.writeHead(Number(code) || 200, { 'Content-Type': 'application/json' });
      resObj.end(JSON.stringify(data));
    } catch(e) {
      console.error('sendJSON error:', e.message);
    }
  };

  const parseBody = (req) => new Promise((resolve)=>{ let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e){ resolve({}); } }); });

  try {
    if (url === '/health') return sendJSON(res, 200, { ok: true });

    // === ДИЛЕР ===
    if (url === '/api/dealer/login' && method === 'POST') {
      const { login, pass } = await parseBody(req);
      if (!login || !pass) return sendJSON(res, 400, { error: 'Введите данные' });
      try {
        const r = await pool.query('SELECT * FROM dealers WHERE login=$1 AND pass=$2', [login, pass]);
        if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
        return sendJSON(res, 200, { ok: true, dealer: { id: r.rows[0].id, name: r.rows[0].name } });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/dealer/result' && method === 'POST') {
      const b = await parseBody(req);
      const resultNumber = parseInt(b.number, 10);
      const resultColor = String(b.color || '');
      if (isNaN(resultNumber)) return sendJSON(res, 400, { error: 'Неверное число' });
      try {
        await pool.query(`
          INSERT INTO roulette_sessions (dealer, nick, bet_type, bet, win, won, date, result_number, result_color) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, ['dealer', 'system', 'number', 0, 0, 0, todayStr(), resultNumber, resultColor]);
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    if (url === '/api/dealer/round' && method === 'POST') {
      const b = await parseBody(req);
      const dealerId = parseInt(b.dealer_id, 10);
      const gameType = String(b.game_type || 'bj'); 
      const nick = String(b.nick || '').trim();
      const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
      const win = Math.round((parseFloat(b.win) || 0) * 100) / 100;

      if (!dealerId) return sendJSON(res, 400, { error: 'Нет ID дилера' });
      if (!nick) return sendJSON(res, 400, { error: 'Введите ник игрока' });
      if (bet <= 0) return sendJSON(res, 400, { error: 'Ставка должна быть больше 0' });

      try {
        const gRes = await pool.query('SELECT * FROM guests WHERE LOWER(name) = LOWER($1) OR id=$1 LIMIT 1', [nick]);
        if (!gRes.rows.length) return sendJSON(res, 404, { error: 'Игрок не найден' });
        const guest = gRes.rows[0];

        const debited = await debitBet(guest.id, bet);
        if (!debited) return sendJSON(res, 400, { error: 'У игрока недостаточно средств' });
        if (win > 0) await creditWin(guest.id, win, bet);

        await pool.query(`INSERT INTO game_history (game, player_name, bet, result, created_at, guest_id) VALUES ($1, $2, $3, $4, NOW(), $5)`, [gameType, guest.name, bet, win, guest.id]);
        
        const net = bet - win; 
        await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `${gameType.toUpperCase()} (Дилер: ${dealerId}, Игрок: ${guest.name})`]);

        await pool.query(`INSERT INTO dealer_daily (dealer_id, date, hands) VALUES ($1, $2, 1) ON CONFLICT (dealer_id, date) DO UPDATE SET hands = dealer_daily.hands + 1`, [dealerId, todayStr()]);

        const bal = await getBalance(guest.id);
        return sendJSON(res, 200, { ok: true, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus });
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ИСТОРИЯ РУЛЕТКИ ===
    if (url === '/api/roulette/history' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(100, parseInt(u.searchParams.get('limit'), 10) || 20);
      try {
        const r = await pool.query(`
          SELECT result_number, result_color, created_at 
          FROM roulette_sessions 
          WHERE result_number IS NOT NULL 
          ORDER BY id DESC LIMIT $1
        `, [limit]);
        return sendJSON(res, 200, r.rows);
      } catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // === ПОСЛЕДНИЕ ВЫИГРЫШИ ===
    if (url === '/api/last-wins' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(50, parseInt(u.searchParams.get('limit'), 10) || 20);
      try {
        const r = await pool.query(`
          SELECT 'crash' AS game, player_name AS player, amount AS bet, amount * cashout_mult AS win, ROUND(cashout_mult::numeric, 2) AS mult, created_at FROM crash_bets WHERE cashed_out = TRUE AND cashout_mult >= 2 AND player_id NOT LIKE 'BOT%'
          UNION ALL
          SELECT game AS game, player_name AS player, bet, result AS win, CASE WHEN bet > 0 THEN ROUND((result / bet)::numeric, 2) ELSE 0 END AS mult, created_at FROM game_history WHERE result > bet AND result >= bet * 1.5 AND game IN ('miner','plinko','ladder','cases')
          ORDER BY created_at DESC LIMIT $1
        `, [limit]);
        return sendJSON(200, r.rows);
      } catch (e) { return sendJSON(500, { error: e.message }); }
    }

    // === ГОСТИ ===
    if (url === '/api/guests' && method === 'GET') {
      const r = await pool.query('SELECT * FROM guests ORDER BY id');
      return sendJSON(200, r.rows);
    }
    if (url === '/api/guest/me' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const id = u.searchParams.get('id');
      if (!id) return sendJSON(400, { error: 'no id' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (!r.rows.length) return sendJSON(404, { error: 'not found' });
      const guest = r.rows[0];
      return sendJSON(200, { 
        guest, 
        balance: { 
          total: (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0), 
          deposit: parseFloat(guest.deposit_balance) || 0, 
          bonus: parseFloat(guest.bonus_balance) || 0 
        }
      });
    }
    if (url === '/api/guest/login' && method === 'POST') {
      const { id, pass } = await parseBody(req);
      if (!id || !pass) return sendJSON(400, { error: 'Введите данные' });
      const r = await pool.query('SELECT * FROM guests WHERE id=$1', [id]);
      if (!r.rows.length) return sendJSON(401, { error: 'Карта не найдена' });
      const g = r.rows[0];
      if (String(pass) !== String(g.pass || '1234')) return sendJSON(401, { error: 'Неверный пароль' });
      return sendJSON(200, { ok: true, guest: g });
    }

    // === СТАТИСТИКА ===
    if (url === '/api/admin/house/stats' && method === 'GET') {
      const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type = 'доход' THEN sum ELSE 0 END), 0)::numeric AS income, COALESCE(SUM(CASE WHEN type = 'расход' THEN sum ELSE 0 END), 0)::numeric AS expense FROM online`);
      const income = parseFloat(r.rows[0].income) || 0;
      const expense = parseFloat(r.rows[0].expense) || 0;
      return sendJSON(200, { treasury: income - expense, today: { turnover: income + expense, expense: expense } });
    }

    // === РАЗДАЧА СТАТИКИ ===
    let file = url === '/' ? '/index.html' : decodeURIComponent(url);
    const safeRelative = path.normalize(file).replace(/^(\.\.[\/\\])+/, '').replace(/^[\/\\]+/, '');
    const filePath = path.join(__dirname, safeRelative);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
    return;

  } catch (e) {
    console.error('Ошибка сервера:', e.message);
    try { sendJSON(res, 500, { error: e.message }); } catch(err) {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Сервер на порту ' + PORT);
});
