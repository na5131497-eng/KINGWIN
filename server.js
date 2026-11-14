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
        fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS online (
        id SERIAL PRIMARY KEY, date TEXT, type TEXT, sum NUMERIC DEFAULT 0, note TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY, game TEXT, player_name TEXT, bet NUMERIC DEFAULT 0, result NUMERIC DEFAULT 0, 
        multiplier NUMERIC DEFAULT 0, status TEXT, guest_id TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
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
      CREATE TABLE IF NOT EXISTS roulette_sessions (
        id SERIAL PRIMARY KEY, dealer TEXT, nick TEXT, bet_type TEXT, bet NUMERIC DEFAULT 0, win NUMERIC DEFAULT 0,
        won INTEGER DEFAULT 0, date TEXT, result_number INTEGER, result_color TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Создаем дефолтного дилера
    const dlCheck = await pool.query(`SELECT * FROM dealers WHERE login = 'dealer'`);
    if (dlCheck.rows.length === 0) {
      await pool.query(`INSERT INTO dealers (name, login, pass) VALUES ($1, $2, $3)`, ['Дилер', 'dealer', '56UpahoS']);
    }
    
    console.log('База данных готова!');
    initCrashBots();
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

const PLINKO_MULTIPLIERS = {
  low: [1.9, 1.4, 1.1, 0.9, 0.5, 0.9, 1.1, 1.4, 1.9],
  medium: [5.0, 2.0, 1.0, 0.5, 0.2, 0.5, 1.0, 2.0, 5.0],
  high: [10.0, 3.0, 0.8, 0.2, 0.1, 0.2, 0.8, 3.0, 10.0]
};

// --- БОТЫ ---
let crashBots = [];
function initCrashBots() {
  const botNames = ['1789****', '4521****', '9034****', '1122****', '8877****', '6633****'];
  crashBots = botNames.map(name => ({ name, bet: [10, 25, 50, 100, 200][Math.floor(Math.random() * 5)] }));
}
function generateBotWin() {
  const bot = crashBots[Math.floor(Math.random() * crashBots.length)];
  const multiplier = [1.5, 2.0, 3.2, 1.8, 4.5][Math.floor(Math.random() * 5)];
  return {
    game: 'crash',
    player: bot.name,
    bet: bot.bet,
    win: Math.round(bot.bet * multiplier * 100) / 100,
    mult: multiplier,
    created_at: new Date().toISOString()
  };
}

// --- БАЛАНС И ВЕЙДЖЕР ---
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

// --- СЕРВЕР ---
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

  const parseBody = (req) => new Promise((resolve)=>{ let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e){ resolve({}); } }); });

  try {
    if (url === '/health') return sendJSON(res, 200, { ok: true });

    // === ИГРЫ ===
    if (url === '/api/crash/bet' && method === 'POST') {
      const b = await parseBody(req);
      const amt = parseFloat(b.amount) || 0;
      const guestId = String(b.player_id || '');
      if (amt < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      if (!guestId) return sendJSON(res, 400, { error: 'Войдите' });
      const debited = await debitBet(guestId, amt);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`, [todayStr(), amt, `Crash bet (${guestId})`]);
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    if (url === '/api/miner/start' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = parseFloat(b.bet) || 0;
      if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'доход', $2, $3)`, [todayStr(), bet, `Miner bet (${guestId})`]);
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    if (url === '/api/plinko/drop' && method === 'POST') {
      const b = await parseBody(req);
      const guestId = String(b.guest_id || '').trim();
      const bet = Math.round((parseFloat(b.bet) || 0) * 100) / 100;
      if (bet < 1) return sendJSON(res, 400, { error: 'Мин 1 ₽' });
      const debited = await debitBet(guestId, bet);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      
      const pathArr = Array.from({length: 8}, () => Math.random() < 0.5 ? 0 : 1);
      const slot = pathArr.reduce((a,b)=>a+b, 0);
      const mults = PLINKO_MULTIPLIERS[b.risk || 'medium'] || PLINKO_MULTIPLIERS.medium;
      const mult = mults[slot];
      const win = Math.round(bet * mult * 100) / 100;
      
      if (win > 0) await creditWin(guestId, win, bet);
      await pool.query(`INSERT INTO game_history (game, player_name, bet, result, multiplier, status, guest_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, ['plinko', guestId, bet, win, mult, win>bet?'win':'lose', guestId]);
      const net = bet - win;
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, $2, $3, $4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Plinko bet (${guestId})`]);
      
      const bal = await getBalance(guestId);
      return sendJSON(res, 200, { ok: true, path: pathArr, slot, multiplier: mult, win, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    if (url === '/api/cases/open' && method === 'POST') {
      const b = await parseBody(req);
      const { guest_id, case_name } = b;
      if (!guest_id || !case_name) return sendJSON(res, 400, { error: 'no data' });
      const c = CASES[case_name];
      if (!c) return sendJSON(res, 400, { error: 'Кейс не найден' });
      const debited = await debitBet(guest_id, c.price);
      if (!debited) return sendJSON(res, 400, { error: 'Недостаточно средств' });
      const prize = pickPrize(c.prizes);
      await creditWin(guest_id, prize, c.price);
      const net = c.price - prize;
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1,$2,$3,$4)`, [todayStr(), net >= 0 ? 'доход' : 'расход', Math.abs(net), `Case ${case_name} (${guest_id})`]);
      const bal = await getBalance(guest_id);
      return sendJSON(res, 200, { ok: true, prize, balance: bal.total, deposit_balance: bal.deposit, bonus_balance: bal.bonus, wagering: bal.wagering });
    }

    // === ПОСЛЕДНИЕ ВЫИГРЫШИ (С БОТАМИ) ===
    if (url === '/api/last-wins' && method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const limit = Math.min(50, parseInt(u.searchParams.get('limit'), 10) || 20);
      try {
        const r = await pool.query(`
          SELECT 'crash' AS game, player_name AS player, amount AS bet, amount * cashout_mult AS win, ROUND(cashout_mult::numeric, 2) AS mult, created_at FROM crash_bets WHERE cashed_out = TRUE AND cashout_mult >= 2 AND player_id NOT LIKE 'BOT%'
          UNION ALL
          SELECT game AS game, player_name AS player, bet, result AS win, CASE WHEN bet > 0 THEN ROUND((result / bet)::numeric, 2) ELSE 0 END AS mult, created_at FROM game_history WHERE result > bet AND result >= bet * 1.5 AND game IN ('miner','plinko','cases')
          ORDER BY created_at DESC LIMIT $1
        `, [limit]);
        
        let wins = r.rows;
        // Добавляем ботов
        for (let i = 0; i < 5; i++) wins.push(generateBotWin());
        wins.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        return sendJSON(res, 200, wins.slice(0, limit));
      } catch (e) { 
        const fakeWins = [];
        for (let i = 0; i < limit; i++) fakeWins.push(generateBotWin());
        return sendJSON(res, 200, fakeWins); 
      }
    }

    // === АДМИНКА: ДЕПОЗИТЫ ===
    if (url === '/api/deposits' && method === 'GET') {
      const r = await pool.query('SELECT * FROM deposits ORDER BY id DESC');
      return sendJSON(200, r.rows);
    }
    if (url === '/api/deposits' && method === 'POST') {
      const d = await parseBody(req);
      const amt = parseFloat(d.sum) || 0;
      if (amt < 100) return sendJSON(res, 400, { error: 'Мин 100 ₽' });
      const r = await pool.query(`INSERT INTO deposits (date,nick,email,sum,status) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [todayStr(), d.nick, d.email, d.sum, 'pending']);
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
          const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) OR id=$1 LIMIT 1`, [nick]);
          if (gRes.rows.length) {
            const guest = gRes.rows[0];
            const pendingBonuses = await pool.query(`SELECT * FROM active_bonuses WHERE guest_id=$1 AND status='pending'`, [guest.id]);
            for (const bonus of pendingBonuses.rows) {
              if (sum >= parseFloat(bonus.min_deposit)) {
                const bonusAmount = parseFloat(bonus.amount);
                const wagerReq = bonusAmount * 5;
                await pool.query(`UPDATE guests SET bonus_balance = bonus_balance + $1, wagering_required = wagering_required + $2, bonus_text = $3 WHERE id = $4`, [bonusAmount, wagerReq, bonus.title, guest.id]);
                await pool.query(`UPDATE active_bonuses SET status='active' WHERE id=$1`, [bonus.id]);
                await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`, [todayStr(), bonusAmount, `Bonus Activated: ${bonus.title} (${guest.id})`]);
              }
            }
          }
        }
      }
      return sendJSON(200, { ok: true });
    }

    // === АДМИНКА: ВЫВОДЫ ===
    if (url === '/api/withdrawals' && method === 'GET') {
      const r = await pool.query('SELECT * FROM withdrawals ORDER BY id DESC');
      return sendJSON(200, r.rows);
    }
    if (url === '/api/withdrawals' && method === 'POST') {
      const w = await parseBody(req);
      const sum = Math.round((parseFloat(w.sum) || 0) * 100) / 100;
      if (sum < 500) return sendJSON(400, { error: 'Мин 500 ₽' });
      
      const gRes = await pool.query(`SELECT * FROM guests WHERE LOWER(name) = LOWER($1) OR id=$1 LIMIT 1`, [w.nick]);
      if (!gRes.rows.length) return sendJSON(404, { error: 'Не найден' });
      const g = gRes.rows[0];
      
      const wagerReq = parseFloat(g.wagering_required) || 0;
      const wagerDone = parseFloat(g.wagering_done) || 0;
      if (wagerReq > 0 && wagerDone < wagerReq) {
        return sendJSON(400, { error: `Сначала отыграйте бонус: ${wagerDone.toFixed(0)} / ${wagerReq.toFixed(0)} ₽` });
      }
      
      const dep = parseFloat(g.deposit_balance) || 0;
      if (dep < sum) return sendJSON(400, { error: `Доступно: ${dep.toFixed(2)} ₽` });
      
      await pool.query(`UPDATE guests SET deposit_balance = deposit_balance - $1 WHERE id=$2`, [sum, g.id]);
      const fee = Math.round(sum * 0.15 * 100) / 100;
      const net = Math.round((sum - fee) * 100) / 100;
      
      const r = await pool.query(`INSERT INTO withdrawals (date, nick, email, sum, fee, net, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [todayStr(), g.name, w.email || '', sum, fee, net, 'pending']);
      await pool.query(`INSERT INTO online (date, type, sum, note) VALUES ($1, 'расход', $2, $3)`, [todayStr(), sum, `Withdraw request (${g.name})`]);
      
      return sendJSON(200, { ok: true, withdrawal: r.rows[0] });
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
      return sendJSON(200, { ok: true });
    }

    // === ГОСТИ ===
    if (url === '/api/guests' && method === 'GET') {
      const r = await pool.query('SELECT * FROM guests ORDER BY id');
      return sendJSON(200, r.rows);
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
        }
      });
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

    // === АДМИНКА: СТАТИСТИКА ===
    if (url === '/api/admin/house/stats' && method === 'GET') {
      const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type = 'доход' THEN sum ELSE 0 END), 0)::numeric AS income, COALESCE(SUM(CASE WHEN type = 'расход' THEN sum ELSE 0 END), 0)::numeric AS expense FROM online`);
      const income = parseFloat(r.rows[0].income) || 0;
      const expense = parseFloat(r.rows[0].expense) || 0;
      return sendJSON(200, { treasury: income - expense, today: { turnover: income + expense, expense: expense } });
    }

    // === ДИЛЕР ===
    if (url === '/api/dealer/login' && method === 'POST') {
      const { login, pass } = await parseBody(req);
      if (!login || !pass) return sendJSON(res, 400, { error: 'Введите данные' });
      const r = await pool.query('SELECT * FROM dealers WHERE login=$1 AND pass=$2', [login, pass]);
      if (!r.rows.length) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
      return sendJSON(res, 200, { ok: true, dealer: { id: r.rows[0].id, name: r.rows[0].name } });
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
