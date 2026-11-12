const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_PASS = '56UpahoS';

// === Railway: путь к БД в /data (Volume), локально — ./kingwin.db ===
const DB_PATH = process.env.RAILWAY_ENVIRONMENT
  ? '/data/kingwin.db'
  : path.join(__dirname, 'kingwin.db');

app.use(cors({
  origin: [
    'https://kingwin-production.up.railway.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HEALTHCHECK ====================
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), db: DB_PATH });
});

// ==================== БАЗА ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB open error:', err);
  else console.log('DB connected:', DB_PATH);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pass TEXT DEFAULT '1234',
    rank TEXT DEFAULT 'Bronze', points INTEGER DEFAULT 0, visits INTEGER DEFAULT 0,
    deposit_balance REAL DEFAULT 0, bonus_balance REAL DEFAULT 0,
    bonus_text TEXT DEFAULT '', bonus_code TEXT DEFAULT '',
    last_visit TEXT, wheel_last_spin TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    login TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
    balance REAL DEFAULT 0, points INTEGER DEFAULT 0,
    sessions INTEGER DEFAULT 0, total_turnover REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    login TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, role TEXT DEFAULT 'admin'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer TEXT, game_type TEXT, nick TEXT,
    dep REAL DEFAULT 0, out_sum REAL DEFAULT 0, fee REAL DEFAULT 0,
    bet REAL DEFAULT 0, win REAL DEFAULT 0,
    jackpot INTEGER DEFAULT 0, jackpot_won REAL DEFAULT 0,
    date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS baccarat (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer TEXT, player TEXT, bet TEXT,
    sum REAL, result TEXT, date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS roulette_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer TEXT NOT NULL, nick TEXT NOT NULL,
    bet_type TEXT NOT NULL, bet_number INTEGER,
    bet REAL NOT NULL, win REAL NOT NULL, won INTEGER,
    bet_source TEXT DEFAULT 'real', date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, nick TEXT, email TEXT,
    sum REAL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, nick TEXT, email TEXT,
    sum REAL, fee REAL, net REAL, status TEXT DEFAULT 'pending', card TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, dealer TEXT, sum REAL, note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS online (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT, sum REAL, note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, user_name TEXT, action TEXT, details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS players (
    nick TEXT PRIMARY KEY, vip INTEGER DEFAULT 0
  )`);

  await run(`CREATE TABLE IF NOT EXISTS cash_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer_id INTEGER, guest_name TEXT,
    type TEXT, sum REAL, status TEXT DEFAULT 'open', date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS dealer_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer_id INTEGER, task_id TEXT, reward REAL,
    date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT, date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS dealer_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guest_name TEXT, dealer_name TEXT,
    stars INTEGER, comment TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS bonus_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id TEXT NOT NULL, type TEXT NOT NULL,
    amount REAL NOT NULL, source TEXT, note TEXT, wager_done REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    prize_pool REAL NOT NULL DEFAULT 100, prize_type TEXT DEFAULT 'bonus',
    wager_multiplier REAL DEFAULT 3, entry_min_bet REAL DEFAULT 30,
    entry_min_bets INTEGER DEFAULT 5, min_participants INTEGER DEFAULT 3,
    start_at TEXT, end_at TEXT, status TEXT DEFAULT 'active',
    winner_id TEXT, winner_name TEXT, winner_score REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tournament_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL,
    guest_id TEXT NOT NULL, guest_name TEXT, score REAL DEFAULT 0,
    bets_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tournament_id, guest_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tournament_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER, guest_id TEXT,
    game TEXT, bet REAL, win REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const owner = await get(`SELECT * FROM employees WHERE login = 'owner'`);
  if (!owner) {
    await run(`INSERT INTO employees (name, login, pass, role) VALUES (?, ?, ?, 'owner')`,
      ['Owner', 'owner', OWNER_PASS]);
    console.log('Created owner: login=owner, pass=' + OWNER_PASS);
  }

  console.log('DB initialized');
}

// ==================== ХЕЛПЕРЫ ====================
function today() { return new Date().toISOString().slice(0, 10); }
function nowStr() { return new Date().toLocaleString('ru-RU'); }

async function addBonusTx(guestId, type, amount, source, note = '', wagerDone = 0) {
  await run(`INSERT INTO bonus_transactions (guest_id, type, amount, source, note, wager_done)
             VALUES (?, ?, ?, ?, ?, ?)`, [guestId, type, amount, source, note, wagerDone]);
}

async function trackBonusWager(guestId, betAmount) {
  const tx = await get(`SELECT id, amount, wager_done FROM bonus_transactions
    WHERE guest_id = ? AND type = 'issue'
    AND (wager_done IS NULL OR wager_done < amount * 3)
    ORDER BY id ASC LIMIT 1`, [guestId]);
  if (!tx) return;
  const newDone = Math.min((tx.wager_done || 0) + betAmount, tx.amount * 3);
  await run(`UPDATE bonus_transactions SET wager_done = ? WHERE id = ?`, [newDone, tx.id]);
}

async function trackTournamentBet(guestId, guestName, game, betAmount, winAmount) {
  const t = await get(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
  if (!t) return;
  if (t.end_at && new Date().toISOString() > t.end_at) return;
  if (betAmount < (t.entry_min_bet || 30)) return;

  await run(`INSERT INTO tournament_entries (tournament_id, guest_id, guest_name, score, bets_count)
             VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(tournament_id, guest_id)
             DO UPDATE SET score = score + ?, bets_count = bets_count + 1`,
    [t.id, guestId, guestName, betAmount, betAmount]);

  await run(`INSERT INTO tournament_bets (tournament_id, guest_id, game, bet, win)
             VALUES (?, ?, ?, ?, ?)`, [t.id, guestId, game, betAmount, winAmount]);
}

// ==================== АВТОРИЗАЦИЯ ====================
app.post('/api/login', async (req, res) => {
  try {
    const { login, pass, type } = req.body;
    if (!login || !pass) return res.status(400).json({ error: 'Заполните все поля' });

    if (type === 'dealer') {
      const dealer = await get(`SELECT * FROM dealers WHERE login = ? AND pass = ?`, [login, pass]);
      if (!dealer) return res.status(401).json({ error: 'Неверный логин или пароль' });
      return res.json({ dealer });
    }

    const emp = await get(`SELECT * FROM employees WHERE login = ? AND pass = ?`, [login, pass]);
    if (!emp) return res.status(401).json({ error: 'Неверный логин или пароль' });
    res.json({ employee: emp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ГОСТИ ====================
app.post('/api/guest/login', async (req, res) => {
  try {
    const { id, pass } = req.body;
    const guest = await get(`SELECT * FROM guests WHERE id = ? AND pass = ?`, [id, pass]);
    if (!guest) return res.status(401).json({ error: 'Неверный номер или пароль' });
    await run(`UPDATE guests SET last_visit = ? WHERE id = ?`, [new Date().toISOString(), id]);
    res.json({ guest });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/guest/me', async (req, res) => {
  try {
    const guest = await get(`SELECT * FROM guests WHERE id = ?`, [req.query.id]);
    if (!guest) return res.status(404).json({ error: 'Не найден' });
    res.json({
      guest,
      balance: {
        total: (parseFloat(guest.deposit_balance) || 0) + (parseFloat(guest.bonus_balance) || 0),
        deposit_balance: guest.deposit_balance,
        bonus_balance: guest.bonus_balance
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/guests', async (req, res) => {
  try { res.json(await all(`SELECT * FROM guests ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/guests', async (req, res) => {
  try {
    const { name, rank = 'Bronze', pass = '1234', bonus_text = '', bonus_code = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'Имя обязательно' });

    const last = await get(`SELECT id FROM guests ORDER BY id DESC LIMIT 1`);
    let nextNum = 1;
    if (last && last.id) {
      const m = String(last.id).match(/(\d+)$/);
      if (m) nextNum = parseInt(m[1]) + 1;
    }
    const newId = 'KING-' + String(nextNum).padStart(4, '0');

    await run(`INSERT INTO guests (id, name, pass, rank, bonus_text, bonus_code)
               VALUES (?, ?, ?, ?, ?, ?)`, [newId, name, pass, rank, bonus_text, bonus_code]);
    res.json({ id: newId, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/guests/update', async (req, res) => {
  try {
    const { id, name, rank, pass, bonus_text, bonus_code, bonus_balance } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id и name обязательны' });
    await run(`UPDATE guests SET name=?, rank=?, pass=?, bonus_text=?, bonus_code=?, bonus_balance=? WHERE id=?`,
      [name, rank, pass, bonus_text, bonus_code, bonus_balance || 0, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/guests/delete', async (req, res) => {
  try { await run(`DELETE FROM guests WHERE id = ?`, [req.body.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/guests/withdraw-deduct', async (req, res) => {
  try {
    const { id, sum } = req.body;
    const g = await get(`SELECT * FROM guests WHERE id = ?`, [id]);
    if (!g) return res.status(404).json({ error: 'Не найден' });
    const bonus = parseFloat(g.bonus_balance) || 0;
    const deposit = parseFloat(g.deposit_balance) || 0;
    let rest = parseFloat(sum) || 0;
    const fromBonus = Math.min(bonus, rest);
    rest -= fromBonus;
    const fromDeposit = Math.min(deposit, rest);
    await run(`UPDATE guests SET bonus_balance = bonus_balance - ?, deposit_balance = deposit_balance - ? WHERE id = ?`,
      [fromBonus, fromDeposit, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/guests/balance', async (req, res) => {
  try {
    const { id, amount, type, op, pass } = req.body;
    if (pass !== OWNER_PASS) return res.status(403).json({ error: 'Неверный пароль' });
    const g = await get(`SELECT * FROM guests WHERE id = ?`, [id]);
    if (!g) return res.status(404).json({ error: 'Не найден' });

    const field = type === 'bonus' ? 'bonus_balance' : 'deposit_balance';
    const delta = op === 'add' ? amount : -amount;
    const newVal = Math.max(0, (parseFloat(g[field]) || 0) + delta);
    await run(`UPDATE guests SET ${field} = ? WHERE id = ?`, [newVal, id]);

    if (type === 'bonus' && op === 'add') {
      await addBonusTx(id, 'issue', amount, 'admin', 'Выдано админом');
    }

    const updated = await get(`SELECT deposit_balance, bonus_balance FROM guests WHERE id = ?`, [id]);
    res.json({ ok: true, balance: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ДЕПОЗИТЫ / ВЫВОДЫ ====================
app.get('/api/deposits', async (req, res) => {
  try { res.json(await all(`SELECT * FROM deposits ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/deposits', async (req, res) => {
  try {
    const { date, nick, email = '', sum, status = 'pending' } = req.body;
    const r = await run(`INSERT INTO deposits (date, nick, email, sum, status) VALUES (?, ?, ?, ?, ?)`,
      [date || today(), nick, email, sum, status]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/deposits/:id', async (req, res) => {
  try { await run(`UPDATE deposits SET status = ? WHERE id = ?`, [req.body.status, req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/deposits/:id', async (req, res) => {
  try { await run(`DELETE FROM deposits WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/withdrawals', async (req, res) => {
  try { res.json(await all(`SELECT * FROM withdrawals ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/withdrawals', async (req, res) => {
  try {
    const { date, nick, email = '', sum, fee = 0, net = sum, status = 'pending', card = '' } = req.body;
    const r = await run(`INSERT INTO withdrawals (date, nick, email, sum, fee, net, status, card)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [date || today(), nick, email, sum, fee, net, status, card]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/withdrawals/:id', async (req, res) => {
  try { await run(`UPDATE withdrawals SET status = ? WHERE id = ?`, [req.body.status, req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/withdrawals/:id', async (req, res) => {
  try { await run(`DELETE FROM withdrawals WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== БЛЭКДЖЕК / БАККАРА ====================
app.get('/api/sessions', async (req, res) => {
  try { res.json(await all(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1000`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions/round', async (req, res) => {
  try {
    const { dealer, game_type, nick, bet, win, jackpot } = req.body;
    if (!nick || !bet) return res.status(400).json({ error: 'Не все поля' });

    const betAmount = parseFloat(bet) || 0;
    const winAmount = parseFloat(win) || 0;

    if (game_type === 'bj') {
      const guest = await get(`SELECT * FROM guests WHERE name = ? COLLATE NOCASE`, [nick]);
      if (!guest) return res.status(404).json({ error: 'Гость не найден' });

      const r = await run(`INSERT INTO sessions (dealer, game_type, nick, dep, out_sum, fee, bet, win, jackpot, date)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dealer, 'bj', nick, betAmount, winAmount, 0, betAmount, winAmount, jackpot ? 1 : 0, today()]);

      const d = await get(`SELECT * FROM dealers WHERE name = ?`, [dealer]);
      if (d) {
        await run(`UPDATE dealers SET sessions = sessions + 1, total_turnover = total_turnover + ? WHERE id = ?`,
          [betAmount, d.id]);
      }

      await trackTournamentBet(guest.id, guest.name, 'bj', betAmount, winAmount);
      return res.json({ id: r.id, ok: true, jackpot_won: jackpot ? winAmount : 0 });
    }

    const r = await run(`INSERT INTO sessions (dealer, game_type, nick, bet, win, date)
                         VALUES (?, ?, ?, ?, ?, ?)`,
      [dealer, 'bac', nick, betAmount, winAmount, today()]);
    const guest = await get(`SELECT * FROM guests WHERE name = ? COLLATE NOCASE`, [nick]);
    if (guest) await trackTournamentBet(guest.id, guest.name, 'bac', betAmount, winAmount);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/baccarat', async (req, res) => {
  try { res.json(await all(`SELECT * FROM baccarat ORDER BY created_at DESC LIMIT 500`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/sessions/:id', async (req, res) => {
  try { await run(`DELETE FROM sessions WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/baccarat/:id', async (req, res) => {
  try { await run(`DELETE FROM baccarat WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== РУЛЕТКА ====================
app.get('/api/sessions/roulette', async (req, res) => {
  try {
    const { dealer } = req.query;
    if (dealer) {
      res.json(await all(`SELECT * FROM roulette_sessions WHERE dealer = ? ORDER BY id DESC LIMIT 500`, [dealer]));
    } else {
      res.json(await all(`SELECT * FROM roulette_sessions ORDER BY id DESC LIMIT 1000`));
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions/roulette', async (req, res) => {
  try {
    const { dealer, nick, bet_type, bet_number, bet, win, won, bet_source = 'real' } = req.body;
    if (!dealer || !nick || !bet_type || bet == null || win == null) {
      return res.status(400).json({ error: 'Не все поля' });
    }

    const betAmount = parseFloat(bet) || 0;
    let winAmount = parseFloat(win) || 0;

    if (winAmount > betAmount * 30) return res.status(400).json({ error: 'Выигрыш превышает максимум' });

    const guest = await get(`SELECT * FROM guests WHERE name = ? COLLATE NOCASE`, [nick]);
    if (!guest) return res.status(404).json({ error: 'Гость не найден' });

    if (bet_source === 'bonus') {
      if ((guest.bonus_balance || 0) < betAmount) {
        return res.status(400).json({ error: 'Недостаточно бонусных фишек' });
      }
      await run(`UPDATE guests SET bonus_balance = bonus_balance - ? WHERE id = ?`, [betAmount, guest.id]);
      await addBonusTx(guest.id, 'bet', -betAmount, 'roulette');

      if (winAmount > 0) {
        const realWin = Math.min(winAmount, betAmount);
        await run(`UPDATE guests SET deposit_balance = deposit_balance + ? WHERE id = ?`, [realWin, guest.id]);
        await addBonusTx(guest.id, 'win', realWin, 'roulette');
        winAmount = realWin;
      }
      await trackBonusWager(guest.id, betAmount);
    } else {
      if ((guest.deposit_balance || 0) < betAmount) {
        return res.status(400).json({ error: 'Недостаточно реальных фишек' });
      }
      await run(`UPDATE guests SET deposit_balance = deposit_balance - ? WHERE id = ?`, [betAmount, guest.id]);
      if (winAmount > 0) {
        await run(`UPDATE guests SET deposit_balance = deposit_balance + ? WHERE id = ?`, [winAmount, guest.id]);
      }
    }

    const r = await run(`INSERT INTO roulette_sessions (dealer, nick, bet_type, bet_number, bet, win, won, bet_source, date)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [dealer, nick, bet_type, bet_number ?? null, betAmount, winAmount, won ? 1 : 0, bet_source, today()]);

    await trackTournamentBet(guest.id, guest.name, 'roulette', betAmount, winAmount);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sessions/roulette/:id', async (req, res) => {
  try { await run(`DELETE FROM roulette_sessions WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ДИЛЕРЫ ====================
app.get('/api/dealers', async (req, res) => {
  try { res.json(await all(`SELECT id, name, login, balance, points, sessions, total_turnover FROM dealers ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dealers', async (req, res) => {
  try {
    const { name, login, pass } = req.body;
    if (!name || !login || !pass) return res.status(400).json({ error: 'Все поля обязательны' });
    const r = await run(`INSERT INTO dealers (name, login, pass) VALUES (?, ?, ?)`, [name, login, pass]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/dealers/:id', async (req, res) => {
  try { await run(`DELETE FROM dealers WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dealer/profile', async (req, res) => {
  try {
    const d = await get(`SELECT * FROM dealers WHERE id = ?`, [req.query.id]);
    if (!d) return res.status(404).json({ error: 'Не найден' });
    const reviews = await all(`SELECT * FROM dealer_reviews WHERE LOWER(dealer_name) = LOWER(?)`, [d.name]);
    const avgStars = reviews.length ? reviews.reduce((a, r) => a + (r.stars || 0), 0) / reviews.length : 0;
    res.json({
      dealer: {
        ...d,
        avg_stars: avgStars,
        rank_label: d.points >= 500 ? 'Diamond' : d.points >= 200 ? 'Platinum' : d.points >= 100 ? 'Gold' : d.points >= 50 ? 'Silver' : 'Bronze',
        rank_color: d.points >= 500 ? '#b9f2ff' : d.points >= 200 ? '#e5e4e2' : d.points >= 100 ? '#f1c40f' : d.points >= 50 ? '#c0c0c0' : '#cd7f32',
        rank_percent: 10, rank_bonus: 0,
        next_label: 'До следующего ранга', next_rank_label: '',
        points_to_next: 50 - (d.points % 50),
        progress_pct: Math.min(100, (d.points % 50) * 2),
        created_at: d.created_at
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dealer/balance', async (req, res) => {
  try {
    const d = await get(`SELECT * FROM dealers WHERE id = ?`, [req.query.id]);
    if (!d) return res.status(404).json({ error: 'Не найден' });
    const withdrawals = await all(`SELECT * FROM withdrawals WHERE LOWER(nick) = LOWER(?) ORDER BY created_at DESC LIMIT 50`, [d.name]);
    res.json({ dealer: d, withdrawals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/withdraw', async (req, res) => {
  try {
    const { id, sum, card } = req.body;
    const d = await get(`SELECT * FROM dealers WHERE id = ?`, [id]);
    if (!d) return res.status(404).json({ error: 'Не найден' });
    if ((d.balance || 0) < sum) return res.status(400).json({ error: 'Недостаточно средств' });
    const fee = Math.round(sum * 0.07 * 100) / 100;
    const net = Math.round((sum - fee) * 100) / 100;
    await run(`UPDATE dealers SET balance = balance - ? WHERE id = ?`, [sum, id]);
    const r = await run(`INSERT INTO withdrawals (date, nick, sum, fee, net, status, card)
                         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [today(), d.name, sum, fee, net, card]);
    res.json({ id: r.id, sum, fee, net, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/change-password', async (req, res) => {
  try {
    const { dealer_id, old_pass, new_pass } = req.body;
    const d = await get(`SELECT * FROM dealers WHERE id = ? AND pass = ?`, [dealer_id, old_pass]);
    if (!d) return res.status(401).json({ error: 'Неверный текущий пароль' });
    await run(`UPDATE dealers SET pass = ? WHERE id = ?`, [new_pass, dealer_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dealer/silence', async (req, res) => {
  try { res.json({ percent: 10, days_passed: 0, days_left: 7 }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== СЕЙФ ====================
app.get('/api/dealer/cash-safe', async (req, res) => {
  try {
    const { id } = req.query;
    const ops = await all(`SELECT * FROM cash_operations WHERE dealer_id = ? AND date = ?`, [id, today()]);
    const totalIn = ops.filter(o => o.type === 'in').reduce((a, o) => a + (o.sum || 0), 0);
    const totalOut = ops.filter(o => o.type === 'out').reduce((a, o) => a + (o.sum || 0), 0);
    res.json({ in_safe: totalIn - totalOut, total_in: totalIn, total_out: totalOut });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dealer/cash-history', async (req, res) => {
  try { res.json(await all(`SELECT * FROM cash_operations WHERE dealer_id = ? AND date = ? ORDER BY created_at DESC`, [req.query.id, today()])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/cash-in', async (req, res) => {
  try {
    const { dealer_id, nick, sum, pass } = req.body;
    const d = await get(`SELECT * FROM dealers WHERE id = ? AND pass = ?`, [dealer_id, pass]);
    if (!d) return res.status(401).json({ error: 'Неверный пароль' });
    await run(`INSERT INTO cash_operations (dealer_id, guest_name, type, sum, date) VALUES (?, ?, 'in', ?, ?)`, [dealer_id, nick, sum, today()]);
    res.json({ ok: true, guest: nick });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/cash-out', async (req, res) => {
  try {
    const { dealer_id, nick, sum, pass } = req.body;
    const d = await get(`SELECT * FROM dealers WHERE id = ? AND pass = ?`, [dealer_id, pass]);
    if (!d) return res.status(401).json({ error: 'Неверный пароль' });
    await run(`INSERT INTO cash_operations (dealer_id, guest_name, type, sum, date) VALUES (?, ?, 'out', ?, ?)`, [dealer_id, nick, sum, today()]);
    res.json({ ok: true, guest: nick });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/cash-handover', async (req, res) => {
  try {
    const { dealer_id } = req.body;
    const ops = await all(`SELECT * FROM cash_operations WHERE dealer_id = ? AND date = ? AND status = 'open'`, [dealer_id, today()]);
    const total = ops.reduce((a, o) => a + (o.type === 'in' ? o.sum : -o.sum), 0);
    await run(`UPDATE cash_operations SET status = 'closed' WHERE dealer_id = ? AND date = ? AND status = 'open'`, [dealer_id, today()]);
    res.json({ ok: true, expected: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/cash-safe', async (req, res) => {
  try {
    const dealers = await all(`SELECT id, name AS dealer_name FROM dealers`);
    const result = [];
    for (const d of dealers) {
      const open = await all(`SELECT * FROM cash_operations WHERE dealer_id = ? AND status = 'open'`, [d.id]);
      const handed = await all(`SELECT * FROM cash_operations WHERE dealer_id = ? AND status = 'closed'`, [d.id]);
      result.push({
        dealer_id: d.id, dealer_name: d.dealer_name,
        open_total: open.reduce((a, o) => a + (o.type === 'in' ? o.sum : -o.sum), 0),
        handed_total: handed.reduce((a, o) => a + (o.type === 'in' ? o.sum : -o.sum), 0),
        handed_cnt: handed.length
      });
    }
    res.json({ dealers: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ЗАДАНИЯ ====================
app.get('/api/dealer/tasks', async (req, res) => {
  try {
    const tasks = [
      { id: 'daily_bj_5', title: 'Сделай 5 раундов блэкджека', goal: 5, reward: 10, type: 'bj' },
      { id: 'daily_bac_3', title: 'Сделай 3 раунда баккары', goal: 3, reward: 10, type: 'bac' },
      { id: 'daily_roulette_5', title: 'Сделай 5 ставок в рулетку', goal: 5, reward: 10, type: 'roulette' }
    ];
    const earned = await get(`SELECT SUM(reward) AS total FROM dealer_tasks WHERE dealer_id = ? AND date = ?`, [req.query.id, today()]);
    res.json({
      day: today(),
      tasks: tasks.map(t => ({ ...t, progress: 0, canClaim: true, claimed: false, blocked: false })),
      earned_today: earned?.total || 0, daily_limit: 50, limit_reached: (earned?.total || 0) >= 50
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/tasks/claim', async (req, res) => {
  try {
    const { dealer_id, task_id } = req.body;
    const reward = 10;
    await run(`INSERT INTO dealer_tasks (dealer_id, task_id, reward, date) VALUES (?, ?, ?, ?)`, [dealer_id, task_id, reward, today()]);
    await run(`UPDATE dealers SET balance = balance + ? WHERE id = ?`, [reward, dealer_id]);
    res.json({ ok: true, reward });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ПРОМОКОДЫ ====================
app.post('/api/promo/check', async (req, res) => {
  try {
    const { code, deposit_amount } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });
    const bonus = Math.min(100, Math.floor((deposit_amount || 0) * 0.5));
    res.json({ code: code.toUpperCase(), bonus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promo/activate', async (req, res) => {
  try {
    const { guest_id, deposit_amount } = req.body;
    const bonus = Math.min(100, Math.floor((deposit_amount || 0) * 0.5));
    const g = await get(`SELECT * FROM guests WHERE id = ?`, [guest_id]);
    if (!g) return res.status(404).json({ error: 'Не найден' });
    await run(`UPDATE guests SET bonus_balance = bonus_balance + ? WHERE id = ?`, [bonus, guest_id]);
    await addBonusTx(guest_id, 'issue', bonus, 'promo', 'Промокод');
    res.json({ ok: true, bonus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PENDING TRANSFERS ====================
app.get('/api/dealer/pending-transfers', async (req, res) => {
  try { res.json(await all(`SELECT * FROM deposits WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dealer/issue-chips', async (req, res) => {
  try {
    const { deposit_id } = req.body;
    const dep = await get(`SELECT * FROM deposits WHERE id = ?`, [deposit_id]);
    if (!dep) return res.status(404).json({ error: 'Депозит не найден' });
    const g = await get(`SELECT * FROM guests WHERE name = ? COLLATE NOCASE`, [dep.nick]);
    if (g) await run(`UPDATE guests SET deposit_balance = deposit_balance + ? WHERE id = ?`, [dep.sum, g.id]);
    await run(`UPDATE deposits SET status = 'approved' WHERE id = ?`, [deposit_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ВЫПЛАТЫ ====================
app.get('/api/payouts', async (req, res) => {
  try { res.json(await all(`SELECT * FROM payouts ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/payouts', async (req, res) => {
  try {
    const { date, dealer, sum, note = '' } = req.body;
    const r = await run(`INSERT INTO payouts (date, dealer, sum, note) VALUES (?, ?, ?, ?)`,
      [date || today(), dealer, sum, note]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/payouts/:id', async (req, res) => {
  try { await run(`DELETE FROM payouts WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== СОТРУДНИКИ ====================
app.get('/api/employees', async (req, res) => {
  try { res.json(await all(`SELECT id, name, login, role FROM employees ORDER BY id`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/employees', async (req, res) => {
  try {
    const { name, login, pass, role } = req.body;
    const r = await run(`INSERT INTO employees (name, login, pass, role) VALUES (?, ?, ?, ?)`, [name, login, pass, role]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/employees/:id', async (req, res) => {
  try {
    const e = await get(`SELECT * FROM employees WHERE id = ?`, [req.params.id]);
    if (e && e.role === 'owner') return res.status(403).json({ error: 'Нельзя удалить владельца' });
    await run(`DELETE FROM employees WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ИГРОКИ VIP ====================
app.get('/api/players', async (req, res) => {
  try { res.json(await all(`SELECT * FROM players`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/players', async (req, res) => {
  try {
    const { nick, vip } = req.body;
    await run(`INSERT INTO players (nick, vip) VALUES (?, ?) ON CONFLICT(nick) DO UPDATE SET vip = ?`,
      [nick, vip ? 1 : 0, vip ? 1 : 0]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== AUDIT ====================
app.get('/api/audit', async (req, res) => {
  try { res.json(await all(`SELECT * FROM audit ORDER BY created_at DESC LIMIT 500`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/audit', async (req, res) => {
  try {
    const { time, user, action, details } = req.body;
    const r = await run(`INSERT INTO audit (time, user_name, action, details) VALUES (?, ?, ?, ?)`,
      [time || nowStr(), user, action, details]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/audit', async (req, res) => {
  try { await run(`DELETE FROM audit`); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== НОВОСТИ ====================
app.get('/api/news', async (req, res) => {
  try { res.json(await all(`SELECT * FROM news ORDER BY date DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/news', async (req, res) => {
  try {
    const { title, body, date } = req.body;
    const r = await run(`INSERT INTO news (title, body, date) VALUES (?, ?, ?)`, [title, body, date || today()]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/news/:id', async (req, res) => {
  try {
    const { title, body, date } = req.body;
    await run(`UPDATE news SET title = ?, body = ?, date = ? WHERE id = ?`, [title, body, date, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/news/:id', async (req, res) => {
  try { await run(`DELETE FROM news WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ОТЗЫВЫ ====================
app.get('/api/dealer-reviews', async (req, res) => {
  try { res.json(await all(`SELECT * FROM dealer_reviews ORDER BY created_at DESC`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dealer-reviews', async (req, res) => {
  try {
    const { guest_name, dealer_name, stars, comment } = req.body;
    const r = await run(`INSERT INTO dealer_reviews (guest_name, dealer_name, stars, comment) VALUES (?, ?, ?, ?)`,
      [guest_name, dealer_name, stars, comment]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/dealer-reviews/:id', async (req, res) => {
  try { await run(`DELETE FROM dealer_reviews WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dealer-ratings', async (req, res) => {
  try {
    res.json(await all(`SELECT dealer_name AS dealer, AVG(stars) AS avg_stars, COUNT(*) AS reviews_count
                        FROM dealer_reviews GROUP BY dealer_name ORDER BY avg_stars DESC`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CRASH (заглушки) ====================
app.get('/api/online', async (req, res) => {
  try { res.json(await all(`SELECT * FROM online ORDER BY created_at DESC LIMIT 200`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/crash/all-bets', async (req, res) => { res.json([]); });
app.delete('/api/crash/clear', async (req, res) => {
  try { await run(`DELETE FROM online`); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/online/:id', async (req, res) => {
  try { await run(`DELETE FROM online WHERE id = ?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ТУРНИР ====================
app.get('/api/tournament/active', async (req, res) => {
  try {
    const t = await get(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    if (!t) return res.json({ tournament: null });
    const cntRow = await get(`SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ?`, [t.id]);
    const participants = cntRow?.cnt || 0;
    const minP = t.min_participants || 3;
    const top = await all(`SELECT guest_name, score, bets_count FROM tournament_entries
                           WHERE tournament_id = ? ORDER BY score DESC LIMIT 10`, [t.id]);
    res.json({
      tournament: t, top, participants, min_participants: minP,
      can_finish: participants >= minP,
      effective_prize: participants >= minP ? t.prize_pool : 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tournament/join', async (req, res) => {
  try {
    const { card } = req.body;
    if (!card) return res.status(400).json({ error: 'Введи номер карты' });
    const t = await get(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    if (!t) return res.status(400).json({ error: 'Нет активного турнира' });
    const guest = await get(`SELECT * FROM guests WHERE id = ?`, [card]);
    if (!guest) return res.status(404).json({ error: 'Карта не найдена' });
    const existing = await get(`SELECT * FROM tournament_entries WHERE tournament_id = ? AND guest_id = ?`, [t.id, guest.id]);
    if (existing) return res.json({ ok: true, already: true });
    await run(`INSERT INTO tournament_entries (tournament_id, guest_id, guest_name, score, bets_count)
               VALUES (?, ?, ?, 0, 0)`, [t.id, guest.id, guest.name]);
    res.json({ ok: true, already: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournaments', async (req, res) => {
  try { res.json(await all(`SELECT * FROM tournaments ORDER BY id DESC LIMIT 50`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/create', async (req, res) => {
  try {
    const { pass, title, prize_pool, days } = req.body;
    if (pass !== OWNER_PASS) return res.status(403).json({ error: 'Нет доступа' });
    const start = new Date().toISOString();
    const end = new Date(Date.now() + (days || 3) * 24 * 60 * 60 * 1000).toISOString();
    await run(`UPDATE tournaments SET status = 'cancelled' WHERE status = 'active'`);
    const r = await run(`INSERT INTO tournaments (title, prize_pool, prize_type, wager_multiplier, entry_min_bet, entry_min_bets, min_participants, start_at, end_at, status)
                         VALUES (?, ?, 'bonus', 3, 30, 5, 3, ?, ?, 'active')`,
      [title || 'Турнир недели', prize_pool || 100, start, end]);
    res.json({ id: r.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/finish', async (req, res) => {
  try {
    const { pass } = req.body;
    if (pass !== OWNER_PASS) return res.status(403).json({ error: 'Нет доступа' });
    const t = await get(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    if (!t) return res.status(404).json({ error: 'Нет активного турнира' });
    const cntRow = await get(`SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ?`, [t.id]);
    const participants = cntRow?.cnt || 0;
    const minP = t.min_participants || 3;
    if (participants < minP) {
      return res.status(400).json({ error: `Мало участников: ${participants}/${minP}`, participants, min_participants: minP });
    }
    const winner = await get(`SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY score DESC LIMIT 1`, [t.id]);
    if (!winner) return res.status(400).json({ error: 'Нет участников' });
    await run(`UPDATE guests SET bonus_balance = bonus_balance + ? WHERE id = ?`, [t.prize_pool, winner.guest_id]);
    await addBonusTx(winner.guest_id, 'issue', t.prize_pool, 'tournament', `Победа в турнире #${t.id}`);
    await run(`UPDATE tournaments SET status = 'finished', winner_id = ?, winner_name = ?, winner_score = ? WHERE id = ?`,
      [winner.guest_id, winner.guest_name, winner.score, t.id]);
    res.json({ ok: true, winner: winner.guest_name, score: winner.score, prize: t.prize_pool,
      wager_required: t.prize_pool * (t.wager_multiplier || 3) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/cancel', async (req, res) => {
  try {
    const { pass, id } = req.body;
    if (pass !== OWNER_PASS) return res.status(403).json({ error: 'Нет доступа' });
    await run(`UPDATE tournaments SET status = 'cancelled' WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/entries', async (req, res) => {
  try { res.json(await all(`SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY score DESC`, [req.params.id])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== АВТОЗАВЕРШЕНИЕ ТУРНИРОВ ====================
setInterval(async () => {
  try {
    const t = await get(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    if (!t || !t.end_at) return;
    if (new Date().toISOString() <= t.end_at) return;

    const cntRow = await get(`SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ?`, [t.id]);
    const participants = cntRow?.cnt || 0;
    const minP = t.min_participants || 3;

    if (participants < minP) {
      await run(`UPDATE tournaments SET status = 'cancelled' WHERE id = ?`, [t.id]);
      console.log(`Tournament #${t.id} auto-cancelled (${participants}/${minP})`);
      return;
    }

    const winner = await get(`SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY score DESC LIMIT 1`, [t.id]);
    if (!winner) {
      await run(`UPDATE tournaments SET status = 'cancelled' WHERE id = ?`, [t.id]);
      return;
    }

    await run(`UPDATE guests SET bonus_balance = bonus_balance + ? WHERE id = ?`, [t.prize_pool, winner.guest_id]);
    await addBonusTx(winner.guest_id, 'issue', t.prize_pool, 'tournament', `Автопобеда в турнире #${t.id}`);
    await run(`UPDATE tournaments SET status = 'finished', winner_id = ?, winner_name = ?, winner_score = ? WHERE id = ?`,
      [winner.guest_id, winner.guest_name, winner.score, t.id]);
    console.log(`Tournament #${t.id} auto-finished. Winner: ${winner.guest_name} (${winner.score} pts)`);
  } catch (e) {
    console.error('Auto-finish tournament error:', e);
  }
}, 60 * 1000);

// ==================== 404 ДЛЯ API ====================
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ==================== SPA FALLBACK ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== СТАРТ ====================
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  KINGWIN SERVER                      ║`);
    console.log(`║  Port: ${PORT}                          ║`);
    console.log(`║  DB: ${DB_PATH}  ║`);
    console.log(`║  Owner: owner / ${OWNER_PASS}         ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
  });
}).catch(e => {
  console.error('Init error:', e);
  process.exit(1);
});
