<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KINGWIN — Админ-панель</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0d14;--panel:rgba(18,24,38,.85);--line:rgba(255,255,255,.05);--text:#fff;--muted:#a0aec0;--accent:#00e5ff;--green:#3fbf7f;--red:#ff4d4d;--amber:#f1c40f;--gold:#d4af37}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',sans-serif;background:radial-gradient(circle at top left,#1a2332,#0a0d14);color:var(--text);display:flex;min-height:100vh}
  aside{width:240px;background:rgba(18,24,38,.95);border-right:1px solid var(--line);padding:25px 15px;flex-shrink:0;transition:transform .3s ease}
  .brand{padding:0 10px 25px;border-bottom:1px solid var(--line);margin-bottom:20px}
  .brand .name{font-size:22px;font-weight:800;letter-spacing:2px;background:linear-gradient(135deg,var(--accent),#0077ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .brand .sub{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:3px}
  .nav{display:flex;flex-direction:column;gap:6px}
  .nav button{background:transparent;border:1px solid transparent;color:var(--muted);text-align:left;padding:12px 15px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:.3s;font-family:inherit}
  .nav button:hover{background:rgba(255,255,255,.05);color:var(--text)}
  .nav button.active{background:rgba(0,229,255,.1);border-color:var(--accent);color:var(--accent)}
  .user-box{padding:12px;margin-top:30px;background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;font-size:12px;color:var(--muted)}
  .user-box b{color:var(--text);display:block;margin-bottom:4px;font-size:14px}
  .logout-btn{width:100%;margin-top:10px;background:transparent;border:1px solid var(--line);color:var(--muted);padding:8px;border-radius:6px;font-size:12px;cursor:pointer;text-transform:uppercase;transition:.3s;font-family:inherit}
  .logout-btn:hover{border-color:var(--red);color:var(--red)}
  main{flex:1;padding:30px 40px;overflow-y:auto;max-height:100vh;min-width:0}
  .page{display:none}
  .page.active{display:block;animation:fadeIn .3s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  h1{font-size:28px;font-weight:700;margin-bottom:6px}
  .sub{color:var(--muted);font-size:14px;margin-bottom:25px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px;backdrop-filter:blur(10px)}
  .card .label{font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
  .card .value{font-size:26px;font-weight:700}
  .card .value.green{color:var(--green)}
  .card .value.red{color:var(--red)}
  .card .value.accent{color:var(--accent)}
  .card .value.gold{color:var(--gold)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:25px;margin-bottom:20px;backdrop-filter:blur(10px)}
  .panel h3{font-size:18px;margin-bottom:20px;font-weight:600;color:var(--text)}
  .chart-wrap{position:relative;height:300px;width:100%}
  canvas{width:100%;height:100%;display:block}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{padding:12px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
  th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  tr:hover td{background:rgba(255,255,255,.02)}
  .pos{color:var(--green);font-weight:600}
  .neg{color:var(--red);font-weight:600}
  .wrap{overflow-x:auto;max-height:55vh;overflow-y:auto}
  .empty{color:var(--muted);text-align:center;padding:30px;font-style:italic}
  button{background:var(--accent);color:#000;border:none;border-radius:8px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;transition:.3s;font-family:inherit}
  button:hover{filter:brightness(1.1);box-shadow:0 0 15px rgba(0,229,255,.3)}
  button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
  button.ghost:hover{border-color:var(--accent);color:var(--accent);box-shadow:none}
  button.danger{background:var(--red);color:#fff}
  button.danger:hover{box-shadow:0 0 15px rgba(255,77,77,.4)}
  button.success{background:var(--green);color:#000}
  button.gold{background:var(--gold);color:#000}
  button.small{padding:6px 12px;font-size:12px}
  .row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
  label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase}
  input,select{background:rgba(0,0,0,.3);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit}
  input:focus,select:focus{outline:none;border-color:var(--accent)}
  .status{display:inline-block;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase}
  .status.pending{background:rgba(241,196,15,.15);color:var(--amber)}
  .status.approved{background:rgba(63,191,127,.15);color:var(--green)}
  .status.rejected{background:rgba(255,77,77,.15);color:var(--red)}
  .status.hold{background:rgba(255,255,255,.1);color:var(--muted)}
  .rank-pill{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700}
  .rank-pill.Bronze{background:rgba(205,127,50,.25);color:#e8a76a;border:1px solid #cd7f32}
  .rank-pill.Silver{background:rgba(192,192,192,.2);color:#d9d9d9;border:1px solid #c0c0c0}
  .rank-pill.Gold{background:rgba(241,196,15,.2);color:#f1c40f;border:1px solid #f1c40f}
  .rank-pill.Platinum{background:rgba(229,228,226,.2);color:#e5e4e2;border:1px solid #e5e4e2}
  .rank-pill.Diamond{background:rgba(185,242,255,.18);color:#b9f2ff;border:1px solid #b9f2ff}
  .rank-pill.VIP{background:rgba(212,175,55,.25);color:#ffe066;border:1px solid #d4af37;box-shadow:0 0 8px rgba(212,175,55,.5)}
  .star-line{color:#f1c40f;font-size:15px;letter-spacing:2px}
  .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center;z-index:1000;padding:20px}
  .modal-backdrop.show{display:flex}
  .modal{background:rgba(18,24,38,.95);border:1px solid var(--accent);border-radius:16px;padding:30px;max-width:480px;width:100%;text-align:center;box-shadow:0 0 30px rgba(0,229,255,.15);max-height:92vh;overflow-y:auto}
  .modal h2{font-size:22px;margin-bottom:15px}
  .modal p{color:var(--muted);font-size:14px;margin-bottom:25px;line-height:1.5}
  .modal .btn-row{display:flex;gap:12px}
  .modal .btn-row button{flex:1}
  .modal .modal-input{background:rgba(0,0,0,.5);border:1px solid var(--line);color:#fff;border-radius:8px;padding:12px;font-size:16px;width:100%;margin-bottom:15px;text-align:center;font-family:inherit}
  .modal .modal-input:focus{outline:none;border-color:var(--accent)}
  .modal .err{color:var(--red);font-size:13px;min-height:18px;margin-bottom:10px}
  .modal .form-row{display:flex;flex-direction:column;gap:10px;text-align:left;margin-bottom:15px}
  .modal .form-row label{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .modal .form-row input,.modal .form-row select{width:100%}
  .login-screen{position:fixed;inset:0;background:radial-gradient(circle at top left,#1a2332,#0a0d14);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px}
  .login-screen.hidden{display:none}
  .login-box{background:rgba(18,24,38,.85);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:20px;padding:40px;width:100%;max-width:400px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5);text-align:center}
  .login-box .logo{font-size:32px;font-weight:800;letter-spacing:3px;background:linear-gradient(135deg,var(--accent),#0077ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:5px}
  .login-box .subtitle{font-size:14px;color:var(--muted);font-weight:600;margin-bottom:35px;text-transform:uppercase;letter-spacing:1px}
  .login-box label{text-align:left;margin-bottom:8px}
  .login-box input{width:100%;background:transparent;border:none;border-bottom:2px solid rgba(255,255,255,.2);color:#fff;font-size:16px;padding:10px 0;margin-bottom:25px;border-radius:0}
  .login-box input:focus{border-bottom-color:var(--accent)}
  .login-box button{width:100%;padding:15px;font-size:16px}
  .login-err{color:var(--red);font-size:13px;height:18px;font-weight:600;margin-bottom:10px}
  .mobile-menu-btn{display:none;position:fixed;top:15px;left:15px;z-index:300;background:rgba(0,229,255,.1);border:1px solid var(--accent);color:var(--accent);border-radius:8px;padding:10px 15px;font-size:16px;cursor:pointer;font-weight:700;backdrop-filter:blur(5px)}
  .mobile-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:240;backdrop-filter:blur(2px)}
  .news-edit-row{display:flex;gap:8px;align-items:flex-start;padding:10px;background:rgba(0,0,0,.3);border-radius:10px;margin-bottom:8px}
  .news-edit-row .col{flex:1;display:flex;flex-direction:column;gap:6px}
  .news-edit-row input,.news-edit-row textarea{width:100%;font-size:13px;padding:8px}
  .news-edit-row textarea{min-height:50px;resize:vertical;font-family:inherit}
  .sessions-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
  .sessions-panel{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:20px;backdrop-filter:blur(10px)}
  .sessions-panel h3{font-size:16px;margin-bottom:15px;font-weight:600;display:flex;align-items:center;gap:10px}
  .sessions-panel h3 .badge-count{font-size:11px;padding:3px 10px;border-radius:10px;background:rgba(0,229,255,.15);color:var(--accent);font-weight:800}
  .sessions-panel.bj h3{color:#00e5ff}
  .sessions-panel.bac h3{color:#f1c40f}
  .mini-table{width:100%;border-collapse:collapse;font-size:12px}
  .mini-table th{padding:8px 6px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--line);text-align:left}
  .mini-table td{padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.02);font-size:12px}
  .mini-table tr:hover td{background:rgba(255,255,255,.02)}
  .mini-table .empty-row td{text-align:center;color:var(--muted);font-style:italic;padding:20px}
  .mini-wrap{max-height:340px;overflow-y:auto}
  .income-calendar{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:5px;margin-top:10px}
  .inc-cell{aspect-ratio:1;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;cursor:pointer;transition:.2s;position:relative;border:1px solid transparent;color:rgba(255,255,255,.85);font-family:'Montserrat',sans-serif}
  .inc-cell:hover{transform:scale(1.15);z-index:10;border-color:#fff;box-shadow:0 0 20px currentColor}
  .inc-cell.zero{background:rgba(255,255,255,.05);color:var(--muted);border-color:rgba(255,255,255,.08)}
  .inc-cell.pos-1{background:rgba(63,191,127,.2);color:#7de0a8}
  .inc-cell.pos-2{background:rgba(63,191,127,.4);color:#a8f0c4}
  .inc-cell.pos-3{background:rgba(63,191,127,.65);color:#d0ffe0}
  .inc-cell.pos-4{background:rgba(63,191,127,.9);color:#0a0d14}
  .inc-cell.neg-1{background:rgba(255,77,77,.2);color:#ff9b9b}
  .inc-cell.neg-2{background:rgba(255,77,77,.4);color:#ffb8b8}
  .inc-cell.neg-3{background:rgba(255,77,77,.65);color:#ffdada}
  .inc-cell.neg-4{background:rgba(255,77,77,.9);color:#0a0d14}
  .inc-tooltip{position:fixed;background:rgba(10,13,20,.98);border:1px solid var(--accent);border-radius:10px;padding:12px 16px;font-size:12px;font-weight:600;color:#fff;pointer-events:none;z-index:5000;opacity:0;transition:opacity .15s;box-shadow:0 10px 30px rgba(0,0,0,.8);white-space:nowrap;line-height:1.5}
  .inc-tooltip.show{opacity:1}
  .inc-tooltip .tt-date{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .inc-tooltip .tt-total{font-size:18px;font-weight:900;margin-bottom:8px}
  .inc-tooltip .tt-total.pos{color:var(--green)}
  .inc-tooltip .tt-total.neg{color:var(--red)}
  .inc-tooltip .tt-row{display:flex;justify-content:space-between;gap:16px;font-size:11px;padding:2px 0}
  .inc-tooltip .tt-row span:first-child{color:var(--muted)}
  .inc-tooltip .tt-row span:last-child{font-weight:800}
  .inc-legend{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-top:14px;flex-wrap:wrap}
  .inc-legend .dot{width:12px;height:12px;border-radius:3px;display:inline-block}
  .inc-legend .dot.pos{background:rgba(63,191,127,.7)}
  .inc-legend .dot.zero{background:rgba(255,255,255,.1)}
  .inc-legend .dot.neg{background:rgba(255,77,77,.7)}
  .day-modal-content{text-align:left}
  .day-modal-title{text-align:center;font-size:22px;font-weight:900;margin-bottom:6px}
  .day-modal-sub{text-align:center;font-size:12px;color:var(--muted);margin-bottom:20px}
  .day-modal-total{text-align:center;font-size:32px;font-weight:900;margin-bottom:20px;line-height:1}
  .day-section{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}
  .day-section-title{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .day-section-title .amt{font-size:14px;font-weight:900}
  .day-list{font-size:12px;line-height:1.7;color:#d0d5e0;max-height:200px;overflow-y:auto}
  .day-list-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03);gap:8px}
  .day-list-item:last-child{border-bottom:none}
  .day-list-item .who{color:var(--muted)}
  .day-list-item .val{font-weight:800}
  .crash-force-block{background:rgba(0,0,0,.3);border:1px solid var(--gold);border-radius:12px;padding:20px;margin-bottom:20px}
  .crash-force-block h3{color:var(--gold);font-size:16px;margin-bottom:10px}
  .crash-force-block .hint{font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px}
  .crash-force-block .hint code{background:rgba(0,229,255,.15);color:var(--accent);padding:1px 6px;border-radius:4px;font-family:'Courier New',monospace}
  .crash-force-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
  .crash-force-row label{flex:1;min-width:140px}
  .crash-force-row input{width:100%}
  .crash-force-status{margin-top:12px;font-size:13px;color:var(--muted);min-height:20px}
  @media (max-width:900px){
    .sessions-grid{grid-template-columns:1fr}
    .mobile-menu-btn{display:block}
    aside{position:fixed;top:0;left:0;height:100vh;z-index:250;transform:translateX(-100%);box-shadow:10px 0 30px rgba(0,0,0,.5)}
    aside.open{transform:translateX(0)}
    .mobile-overlay.show{display:block}
    main{padding:70px 15px 20px}
    h1{font-size:22px}
    .sub{font-size:13px;margin-bottom:20px}
    .cards{grid-template-columns:1fr 1fr;gap:10px}
    .card{padding:15px}
    .card .value{font-size:20px}
    .card .label{font-size:11px}
    .panel{padding:15px}
    .panel h3{font-size:16px;margin-bottom:15px}
    .chart-wrap{height:220px}
    .row{gap:10px}
    label{font-size:11px;width:100%}
    label input,label select{width:100%}
    .row button{width:100%}
    .modal{padding:20px}
  }
  @media (max-width:480px){
    .cards{grid-template-columns:1fr}
    .chart-wrap{height:180px}
    .card .value{font-size:18px}
    h1{font-size:20px}
    .panel{padding:12px}
    th,td{padding:8px 5px}
  }
</style>
</head>
<body>

<button class="mobile-menu-btn" onclick="toggleMenu()">☰</button>
<div class="mobile-overlay" id="mobileOverlay" onclick="toggleMenu()"></div>

<div class="login-screen" id="loginScreen">
  <div class="login-box">
    <div class="logo">KINGWIN</div>
    <div class="subtitle">Вход в консоль</div>
    <label>Username</label>
    <input type="text" id="loginUser" placeholder="Owner" autocomplete="username">
    <label>Password</label>
    <input type="password" id="loginPass" placeholder="••••••" autocomplete="current-password">
    <div class="login-err" id="loginErr"></div>
    <button onclick="doLogin()">Войти</button>
  </div>
</div>

<aside id="sidebar">
  <div class="brand">
    <div class="name">KINGWIN</div>
    <div class="sub">Admin Panel</div>
  </div>
  <div class="nav">
    <button class="active" data-page="dash" onclick="switchPage('dash')">Главная</button>
    <button data-page="finance" onclick="switchPage('finance')">Депозиты и выводы</button>
    <button data-page="players" onclick="switchPage('players')">Игроки</button>
    <button data-page="guests" onclick="switchPage('guests')">Гости (Профиль 2)</button>
    <button data-page="news" onclick="switchPage('news')">📰 Новости</button>
    <button data-page="reviews" onclick="switchPage('reviews')">⭐ Отзывы о дилерах</button>
    <button data-page="online" onclick="switchPage('online')">Онлайн-казино (Crash)</button>
    <button data-page="payouts" onclick="switchPage('payouts')">Выплаты дилерам</button>
    <button data-page="history" onclick="switchPage('history')">История</button>
    <button data-page="roles" onclick="switchPage('roles')">Роли</button>
  </div>
  <div class="user-box">
    Вы вошли как: <b id="currentUser">—</b>
    <span id="currentRole" style="font-size:11px; color:var(--muted)">—</span>
    <button class="logout-btn" onclick="openLogoutModal()">Выйти</button>
  </div>
</aside>

<main>
  <div class="page active" id="page-dash">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div><h1>Общая статистика</h1><div class="sub">Доходы казино</div></div>
      <button class="danger" onclick="openClearModal()">Очистить всё</button>
    </div>
    <div class="cards" id="dashCards"></div>
    <div class="panel">
      <h3>Общий график доходов</h3>
      <div class="chart-wrap"><canvas id="incomeChart"></canvas></div>
    </div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div>
          <h3 style="margin:0">📅 Доход за всё время</h3>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">Наведи на квадрат — увидишь сумму. Кликни — откроется подробный отчёт за день.</div>
        </div>
        <div id="incSummaryBadge" style="font-size:26px;font-weight:900;line-height:1"></div>
      </div>
      <div class="income-calendar" id="incomeCalendar"></div>
      <div class="inc-legend">
        <span class="dot pos"></span> Плюс
        <span class="dot zero"></span> Ноль
        <span class="dot neg"></span> Минус
        <span style="margin-left:auto;color:var(--muted)">Всего дней: <b id="incDaysCount" style="color:#fff">0</b></span>
      </div>
      <div class="empty" id="incomeCalendarEmpty">Пока нет данных</div>
    </div>
    <div class="sessions-grid">
      <div class="sessions-panel bj">
        <h3>🎲 Сессии Блэкджека <span class="badge-count" id="bjCount">0</span></h3>
        <div class="mini-wrap">
          <table class="mini-table">
            <thead><tr><th>Игрок</th><th>Ставка</th><th>Выигрыш</th><th>Дилер</th><th>Время</th></tr></thead>
            <tbody id="bjSessionsBody"></tbody>
          </table>
        </div>
      </div>
      <div class="sessions-panel bac">
        <h3>🎴 Сессии Баккары <span class="badge-count" id="bacCount">0</span></h3>
        <div class="mini-wrap">
          <table class="mini-table">
            <thead><tr><th>Игрок</th><th>Ставка</th><th>Выигрыш</th><th>Дилер</th><th>Время</th></tr></thead>
            <tbody id="bacSessionsBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div class="page" id="page-finance">
    <h1>Депозиты и выводы</h1>
    <div class="sub">Заявки от игроков и гостей</div>
    <div class="panel"><h3>Депозиты</h3>
      <div class="wrap"><table><thead><tr><th>Дата</th><th>Игрок</th><th>Сумма</th><th>Статус</th><th>Действия</th></tr></thead><tbody id="depositsBody"></tbody></table></div>
      <div class="empty" id="depositsEmpty">Нет заявок</div>
    </div>
    <div class="panel"><h3>Выводы</h3>
      <div class="wrap"><table><thead><tr><th>Дата</th><th>Игрок</th><th>Сумма</th><th>Комиссия</th><th>На руки</th><th>Статус</th><th>Действия</th></tr></thead><tbody id="withdrawalsBody"></tbody></table></div>
      <div class="empty" id="withdrawalsEmpty">Нет заявок</div>
    </div>
  </div>

  <div class="page" id="page-players">
    <h1>Игроки</h1>
    <div class="sub">Сводная статистика по игрокам</div>
    <div class="cards" id="playerCards"></div>
    <div class="panel">
      <div class="wrap"><table><thead><tr><th>#</th><th>Ник</th><th>Блэкджек</th><th>Баккара</th><th>Общий</th><th>VIP</th><th>Действия</th></tr></thead><tbody id="playersBody"></tbody></table></div>
      <div class="empty" id="playersEmpty">Нет игроков</div>
    </div>
  </div>

  <div class="page" id="page-guests">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div><h1>Гости (Профиль 2)</h1><div class="sub">База постоянных гостей и клубных карт</div></div>
      <button onclick="window.open('/cards_print.html','_blank')" class="success">🖨 Печать всех карт</button>
    </div>
    <div class="panel">
      <h3>Добавить гостя</h3>
      <div class="row">
        <label>Имя<input type="text" id="g_name" placeholder="Иван"></label>
        <label>Ранг<select id="g_rank">
          <option value="Bronze">Bronze</option>
          <option value="Silver">Silver</option>
          <option value="Gold">Gold</option>
          <option value="Platinum">Platinum</option>
          <option value="Diamond">Diamond</option>
          <option value="VIP">VIP</option>
        </select></label>
        <label>Пароль карты<input type="text" id="g_pass" placeholder="1234" value="1234"></label>
        <label>Подарок (текст)<input type="text" id="g_bonus_text" placeholder="Поздравляем! ..."></label>
        <label>Код<input type="text" id="g_bonus_code" placeholder="GIFT-..."></label>
        <button onclick="addGuest()">Добавить</button>
      </div>
    </div>
    <div class="panel">
      <h3>Список гостей</h3>
      <div class="wrap"><table><thead><tr>
        <th>Номер карты</th><th>Имя</th><th>Ранг</th><th>Баллы</th><th>Визиты</th><th>Депозит</th><th>Бонусы</th><th>🔥 Streak</th><th>Последний вход</th><th>Крутил</th><th>Действия</th>
      </tr></thead><tbody id="guestsBody"></tbody></table></div>
      <div class="empty" id="guestsEmpty">Нет гостей</div>
    </div>
  </div>

  <div class="page" id="page-news">
    <h1>📰 Новости и акции</h1>
    <div class="sub">Отображаются в профиле гостя</div>
    <div class="panel">
      <h3>Добавить новость</h3>
      <div class="news-edit-row" style="background:rgba(0,229,255,.05)">
        <div class="col">
          <input type="text" id="n_title" placeholder="Заголовок (например: ×2 баллы в пятницу)">
          <textarea id="n_body" placeholder="Текст новости..."></textarea>
          <input type="date" id="n_date">
        </div>
        <button class="success" onclick="addNews()">Добавить</button>
      </div>
    </div>
    <div class="panel">
      <h3>Опубликованные</h3>
      <div id="newsList"></div>
      <div class="empty" id="newsEmpty">Нет новостей</div>
    </div>
  </div>

  <div class="page" id="page-reviews">
    <h1>⭐ Отзывы о дилерах</h1>
    <div class="sub">Оценки от гостей — рейтинг, комментарии</div>
    <div class="cards" id="reviewCards"></div>
    <div class="panel">
      <h3>Рейтинг дилеров</h3>
      <div class="wrap"><table><thead><tr><th>#</th><th>Дилер</th><th>Средний рейтинг</th><th>Отзывов</th></tr></thead><tbody id="ratingsBody"></tbody></table></div>
      <div class="empty" id="ratingsEmpty">Пока нет оценок</div>
    </div>
    <div class="panel">
      <h3>Все отзывы</h3>
      <div class="wrap"><table><thead><tr><th>Дата</th><th>Гость</th><th>Дилер</th><th>Оценка</th><th>Комментарий</th><th></th></tr></thead><tbody id="reviewsBody"></tbody></table></div>
      <div class="empty" id="reviewsEmpty">Пока нет отзывов</div>
    </div>
  </div>

  <div class="page" id="page-online">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div><h1>Онлайн-казино (Crash)</h1><div class="sub">История успешных выводов и ставок в раундах</div></div>
      <button class="danger" onclick="openClearCrashModal()">Очистить историю Crash</button>
    </div>
    <div class="cards" id="onlineCards"></div>
    <div class="crash-force-block">
      <h3>🎯 Контроль следующего краша</h3>
      <div class="hint">
        Введи коэффициент — <b>следующий раунд</b> крашнется именно на нём. После этого значение автоматически сбросится.<br>
        Например: <code>1.5</code> — краш на x1.5, <code>10</code> — на x10. Диапазон: 1.00 – 1000.
      </div>
      <div class="crash-force-row">
        <label>Следующий краш (x)<input type="number" id="crashForceInput" step="0.01" min="1" max="1000" placeholder="например, 2.5"></label>
        <button class="gold" onclick="setCrashForce()">🎯 Задать</button>
        <button class="ghost" onclick="clearCrashForce()">Сбросить</button>
      </div>
      <div class="crash-force-status" id="crashForceStatus"></div>
    </div>
    <div class="panel">
      <h3>Успешные выводы (Кэшауты)</h3>
      <div class="wrap"><table><thead><tr><th>Дата</th><th>Игрок</th><th>Ставка</th><th>Кэф вывода</th><th>Сумма к выплате</th><th>Раунд</th></tr></thead><tbody id="onlineBody"></tbody></table></div>
      <div class="empty" id="onlineEmpty">Пока нет кэшаутов</div>
    </div>
  </div>

  <div class="page" id="page-payouts">
    <h1>Выплаты дилерам</h1>
    <div class="sub">Начисления, зарплаты, сейфы</div>
    <div class="cards" id="payoutCards"></div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:15px">
        <h3 style="margin:0">📦 Сейфы дилеров</h3>
        <button class="ghost small" onclick="loadCashSafeAdmin()">🔄 Обновить</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Сколько наличных у дилеров в сейфах. Когда дилер сдаёт — вы пересчитываете и подтверждаете.</div>
      <div class="wrap"><table><thead><tr><th>Дилер</th><th>В сейфе</th><th>Сдано (ожидается)</th><th>Действия</th></tr></thead><tbody id="safeBody"></tbody></table></div>
      <div class="empty" id="safeEmpty">Нет данных</div>
    </div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:15px">
        <h3 style="margin:0">🎰 Фишки за день</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="date" id="chipsDateInput" onchange="loadChipsReport()" style="background:rgba(0,0,0,.3);border:1px solid var(--line);color:#fff;padding:8px 12px;border-radius:8px;font-family:inherit">
        </div>
      </div>
      <div class="cards" id="chipsCards" style="margin-bottom:15px"></div>
      <div class="wrap"><table><thead><tr><th>Дилер</th><th>Выдано</th><th>Принято</th><th>Прибыль</th></tr></thead><tbody id="chipsReportBody"></tbody></table></div>
      <div class="empty" id="chipsReportEmpty">Нет данных</div>
    </div>
    <div class="panel">
      <h3>Выдать зарплату</h3>
      <div class="row">
        <label>Дата<input type="date" id="pay_date"></label>
        <label>Дилер<input type="text" id="pay_dealer" placeholder="Имя"></label>
        <label>Сумма<input type="number" id="pay_sum" placeholder="100"></label>
        <label>Примечание<input type="text" id="pay_note" placeholder="—"></label>
        <button onclick="openPayoutModal()">Выдать</button>
      </div>
    </div>
    <div class="panel"><h3>Начислено</h3>
      <div class="wrap"><table><thead><tr><th>#</th><th>Дилер</th><th>Сессий</th><th>Доход</th><th>Начислено</th><th>Выплачено</th><th>Остаток</th></tr></thead><tbody id="accruedBody"></tbody></table></div>
      <div class="empty" id="accruedEmpty">Нет данных</div>
    </div>
    <div class="panel"><h3>История выплат</h3>
      <div class="wrap"><table><thead><tr><th>#</th><th>Дата</th><th>Дилер</th><th>Сумма</th><th>Примечание</th><th></th></tr></thead><tbody id="payoutBody"></tbody></table></div>
      <div class="empty" id="payoutEmpty">Нет выплат</div>
    </div>
  </div>

  <div class="page" id="page-history">
    <h1>История действий</h1>
    <div class="sub">Лог всех операций в системе</div>
    <div class="panel">
      <div class="row" style="margin-bottom:15px"><button class="ghost" onclick="clearHistory()">Очистить историю</button></div>
      <div class="wrap"><table><thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Детали</th></tr></thead><tbody id="historyBody"></tbody></table></div>
      <div class="empty" id="historyEmpty">Нет записей</div>
    </div>
  </div>

  <div class="page" id="page-roles">
    <h1>Роли</h1>
    <div class="sub">Управление доступами</div>
    <div class="panel"><h3>Сотрудники</h3>
      <div class="wrap"><table><thead><tr><th>#</th><th>Имя</th><th>Логин</th><th>Роль</th><th>Действия</th></tr></thead><tbody id="rolesBody"></tbody></table></div>
      <div class="empty" id="rolesEmpty">Нет сотрудников</div>
    </div>
    <div class="panel"><h3>Добавить сотрудника</h3>
      <div class="row">
        <label>Имя<input type="text" id="r_name" placeholder="Иван"></label>
        <label>Логин<input type="text" id="r_login" placeholder="ivan"></label>
        <label>Пароль<input type="text" id="r_pass" placeholder="пароль"></label>
        <label>Роль<select id="r_role"><option value="admin">Админ</option><option value="cashier">Кассир</option></select></label>
        <button onclick="addEmployee()">Добавить</button>
      </div>
    </div>
    <div class="panel"><h3>Дилеры (доступ к dealer.html)</h3>
      <div class="wrap"><table><thead><tr><th>#</th><th>Имя</th><th>Логин</th><th>Действия</th></tr></thead><tbody id="dealersBody"></tbody></table></div>
      <div class="empty" id="dealersEmpty">Нет дилеров</div>
    </div>
    <div class="panel"><h3>Добавить дилера</h3>
      <div class="row">
        <label>Имя<input type="text" id="d_name" placeholder="Пётр"></label>
        <label>Логин<input type="text" id="d_login" placeholder="petr"></label>
        <label>Пароль<input type="text" id="d_pass" placeholder="пароль"></label>
        <button onclick="addDealer()">Добавить</button>
      </div>
    </div>
  </div>
</main>
<div class="modal-backdrop" id="confirmModal">
  <div class="modal">
    <h2 id="confirmTitle">Подтверждение</h2>
    <p id="confirmText"></p>
    <div class="btn-row">
      <button class="ghost" onclick="closeConfirm()">Отмена</button>
      <button id="confirmBtn">OK</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="passModal">
  <div class="modal">
    <h2 id="passTitle">Введите пароль</h2>
    <p id="passText"></p>
    <input type="password" class="modal-input" id="passInput" placeholder="Пароль">
    <div class="err" id="passErr"></div>
    <div class="btn-row">
      <button class="ghost" onclick="closePassModal()">Отмена</button>
      <button class="success" onclick="confirmPass()">Подтвердить</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="logoutModal">
  <div class="modal">
    <h2>Выход из аккаунта</h2>
    <p>Вы уверены, что хотите выйти?</p>
    <div class="btn-row">
      <button class="ghost" onclick="closeLogoutModal()">Отмена</button>
      <button class="danger" onclick="confirmLogout()">Выйти</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="clearAllModal">
  <div class="modal" style="border-color: var(--red); box-shadow: 0 0 30px rgba(255, 77, 77, 0.15);">
    <h2 style="color: var(--red);">ВНИМАНИЕ!</h2>
    <p>Вы собираетесь <b>ПОЛНОСТЬЮ ОЧИСТИТЬ</b> базу данных. Будут удалены ВСЕ сессии, баккара, депозиты, выводы, выплаты, история, база гостей, доходы онлайн-казино и история Crash.<br><br>Введите пароль владельца для подтверждения:</p>
    <input type="password" class="modal-input" id="clearAllPass" placeholder="Пароль владельца">
    <div class="err" id="clearAllErr"></div>
    <div class="btn-row">
      <button class="ghost" onclick="closeClearAllModal()">Отмена</button>
      <button class="danger" onclick="confirmClearAll()">УДАЛИТЬ ВСЁ</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="clearCrashModal">
  <div class="modal" style="border-color: var(--red); box-shadow: 0 0 30px rgba(255, 77, 77, 0.15);">
    <h2 style="color: var(--red);">Очистить историю Crash?</h2>
    <p>Будут удалены ВСЕ раунды Crash, все ставки (включая ботов) и все записи о доходах Crash из онлайн-казино.<br><br>Введите пароль владельца для подтверждения:</p>
    <input type="password" class="modal-input" id="clearCrashPass" placeholder="Пароль владельца">
    <div class="err" id="clearCrashErr"></div>
    <div class="btn-row">
      <button class="ghost" onclick="closeClearCrashModal()">Отмена</button>
      <button class="danger" onclick="confirmClearCrash()">ОЧИСТИТЬ CRASH</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="editGuestModal">
  <div class="modal">
    <h2>Редактировать гостя</h2>
    <div class="form-row">
      <div><label>Имя</label><input type="text" id="eg_name"></div>
      <div><label>Ранг</label><select id="eg_rank">
        <option value="Bronze">Bronze</option>
        <option value="Silver">Silver</option>
        <option value="Gold">Gold</option>
        <option value="Platinum">Platinum</option>
        <option value="Diamond">Diamond</option>
        <option value="VIP">VIP</option>
      </select></div>
      <div><label>Пароль карты</label><input type="text" id="eg_pass"></div>
      <div><label>Подарок (текст)</label><input type="text" id="eg_bonus_text"></div>
      <div><label>Код подарка</label><input type="text" id="eg_bonus_code"></div>
      <div><label>Бонусные ₽ (Подарочные)</label><input type="number" id="eg_bonus_balance" step="0.01" min="0"></div>
      <div><label>🔥 Streak (дней подряд)</label><input type="number" id="eg_streak" min="0" max="7" step="1"></div>
    </div>
    <div class="err" id="eg_err"></div>
    <div class="btn-row">
      <button class="ghost" onclick="closeEditGuestModal()">Отмена</button>
      <button class="success" onclick="saveEditGuest()">Сохранить</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="dayIncomeModal">
  <div class="modal" style="max-width: 560px;">
    <button class="ghost" style="position:absolute; top:15px; right:15px; width:auto; padding:4px 12px; font-size:16px;" onclick="closeDayIncomeModal()">✕</button>
    <div class="day-modal-content" id="dayIncomeContent"></div>
  </div>
</div>

<script>
let db = { sessions: [], baccarat: [], deposits: [], withdrawals: [], payouts: [], players: [], audit: [], employees: [], dealers: [], online: [], guests: [], crash_bets: [], dealer_reviews: [], dealer_ratings: [], dealerCash: [] };
let newsList = [];
let currentUser = null;
let currentRole = null;
let editGuestId = null;

function fmt(n){ return (Math.round((n||0)*100)/100).toLocaleString('ru-RU'); }
function today(){ return new Date().toISOString().slice(0,10); }
function now(){ return new Date().toLocaleString('ru-RU'); }

function toggleMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobileOverlay');
  sidebar.classList.toggle('open');
  if (sidebar.classList.contains('open')) overlay.classList.add('show');
  else overlay.classList.remove('show');
}

async function apiGet(url){
  try { const r = await fetch(url); if (!r.ok) return []; return await r.json(); }
  catch(e) { return []; }
}
async function apiPost(url, data){
  try { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }); return await r.json(); }
  catch(e) { return { error: e.message }; }
}
async function apiPut(url, data){
  try { const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }); return await r.json(); }
  catch(e) { return { error: e.message }; }
}
async function apiDelete(url){
  try { const r = await fetch(url, { method:'DELETE' }); return await r.json(); }
  catch(e) { return { error: e.message }; }
}

async function loadDB(){
  const endpoints = {
    sessions: '/api/sessions',
    baccarat: '/api/baccarat',
    deposits: '/api/deposits',
    withdrawals: '/api/withdrawals',
    payouts: '/api/payouts',
    players: '/api/players',
    audit: '/api/audit',
    employees: '/api/employees',
    dealers: '/api/dealers',
    online: '/api/online',
    guests: '/api/guests',
    crash_bets: '/api/crash/all-bets',
    dealer_reviews: '/api/dealer-reviews',
    dealer_ratings: '/api/dealer-ratings'
  };
  const results = await Promise.all(
    Object.entries(endpoints).map(async ([key, url]) => {
      const data = await apiGet(url);
      return [key, Array.isArray(data) ? data : []];
    })
  );
  results.forEach(([key, data]) => { db[key] = data; });
}

async function loadNewsList(){
  const data = await apiGet('/api/news');
  newsList = Array.isArray(data) ? data : [];
}

async function audit(action, details){
  if(!currentUser) return;
  await apiPost('/api/audit', { time: now(), user: currentUser, action, details });
}

const ROLES = {
  owner:   {label:'Владелец', perms:['dash','finance','players','guests','news','reviews','online','payouts','history','roles']},
  admin:   {label:'Админ', perms:['dash','finance','players','guests','news','reviews','online','payouts','history']},
  cashier: {label:'Кассир', perms:['dash','finance']}
};
function hasPerm(page){ const r = ROLES[currentRole]; return r ? r.perms.includes(page) : false; }

function switchPage(page) {
  if(!hasPerm(page)){ showInfo('Нет доступа', 'У вашей роли нет доступа.'); return; }
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  const b = document.querySelector(`.nav button[data-page="${page}"]`);
  if(b) b.classList.add('active');
  document.getElementById('page-'+page).classList.add('active');
  renderAll();
  if (page === 'online') loadCrashForceStatus();
  if(window.innerWidth <= 900) toggleMenu();
}

async function doLogin(){
  const login = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, pass, type: 'admin' }) });
    const data = await r.json();
    if(!r.ok){ err.textContent = data.error || 'Ошибка'; return; }
    currentUser = data.employee.name;
    currentRole = data.employee.role;
    err.textContent = '';
    document.getElementById('loginScreen').classList.add('hidden');
    await audit('login', `${currentUser} вошёл`);
    await Promise.all([loadDB(), loadNewsList()]);
    switchPage('dash');
    renderAll();
    loadCrashForceStatus();
  } catch(e){ err.textContent = 'Ошибка соединения'; }
}

function openLogoutModal(){ document.getElementById('logoutModal').classList.add('show'); }
function closeLogoutModal(){ document.getElementById('logoutModal').classList.remove('show'); }

async function confirmLogout(){
  await audit('logout', `${currentUser} вышел`);
  currentUser = null; currentRole = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUser').focus();
  closeLogoutModal();
}

function openClearModal(){ document.getElementById('clearAllModal').classList.add('show'); }
function closeClearAllModal(){ document.getElementById('clearAllModal').classList.remove('show'); }
function openClearCrashModal(){ document.getElementById('clearCrashModal').classList.add('show'); }
function closeClearCrashModal(){ document.getElementById('clearCrashModal').classList.remove('show'); }

async function confirmClearAll(){
  const pass = document.getElementById('clearAllPass').value;
  if(pass !== '56UpahoS'){ document.getElementById('clearAllErr').textContent = 'Неверный пароль.'; return; }
  for(const s of db.sessions) await apiDelete('/api/sessions/' + s.id);
  for(const b of db.baccarat) await apiDelete('/api/baccarat/' + b.id);
  for(const d of db.deposits) await apiDelete('/api/deposits/' + d.id);
  for(const w of db.withdrawals) await apiDelete('/api/withdrawals/' + w.id);
  for(const p of db.payouts) await apiDelete('/api/payouts/' + p.id);
  for(const o of db.online) await apiDelete('/api/online/' + o.id);
  await apiDelete('/api/audit');
  for(const g of db.guests) await apiPost('/api/guests/delete', { id: g.id });
  await apiDelete('/api/crash/clear');
  closeClearAllModal();
  await loadDB();
  renderAll();
  showInfo('Успех', 'Все данные успешно удалены.');
}

async function confirmClearCrash(){
  const pass = document.getElementById('clearCrashPass').value;
  if(pass !== '56UpahoS'){ document.getElementById('clearCrashErr').textContent = 'Неверный пароль.'; return; }
  await apiDelete('/api/crash/clear');
  closeClearCrashModal();
  await loadDB();
  renderAll();
  showInfo('Успех', 'История Crash полностью очищена.');
}

document.getElementById('loginPass').addEventListener('keypress', e=>{ if(e.key==='Enter') doLogin(); });

let confirmAction = null;
function showConfirm(title, text, btnLabel, btnClass, action){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').innerHTML = text;
  const btn = document.getElementById('confirmBtn');
  btn.textContent = btnLabel; btn.className = btnClass;
  confirmAction = action;
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirm(){ document.getElementById('confirmModal').classList.remove('show'); confirmAction = null; }
document.getElementById('confirmBtn').onclick = async ()=>{ if(confirmAction) await confirmAction(); closeConfirm(); };

function showInfo(title, text){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').innerHTML = text;
  const btn = document.getElementById('confirmBtn');
  btn.textContent = 'OK'; btn.className = 'success';
  confirmAction = null;
  document.getElementById('confirmModal').classList.add('show');
}

let passAction = null;
function showPass(title, text, action){
  document.getElementById('passTitle').textContent = title;
  document.getElementById('passText').innerHTML = text;
  document.getElementById('passInput').value = '';
  document.getElementById('passErr').textContent = '';
  passAction = action;
  document.getElementById('passModal').classList.add('show');
  document.getElementById('passInput').focus();
}
function closePassModal(){ document.getElementById('passModal').classList.remove('show'); passAction = null; }
async function confirmPass(){
  const pass = document.getElementById('passInput').value;
  if(pass !== '56UpahoS'){ document.getElementById('passErr').textContent = 'Неверный пароль.'; return; }
  if(passAction) await passAction();
  closePassModal();
}
document.getElementById('passInput').addEventListener('keypress', e=>{ if(e.key==='Enter') confirmPass(); });

function bacCalc(r){
  let payout = 0;
  if(r.bet === 'игрок'){ if(r.result === 'игрок') payout = r.sum * 2; else if(r.result === 'ничья') payout = r.sum; }
  else if(r.bet === 'банк'){ if(r.result === 'банк') payout = r.sum * 1.95; else if(r.result === 'ничья') payout = r.sum; }
  else { if(r.result === 'ничья') payout = r.sum * 9; }
  return { payout, casino: r.sum - payout };
}
function sessionNet(s){
  const dep = parseFloat(s.dep) || 0;
  const outSum = parseFloat(s.out_sum) || 0;
  const fee = parseFloat(s.fee) || 0;
  const net = outSum - fee;
  return { dep, outSum, fee, net, income: dep - net };
}
function bjStats(){
  let turnover = 0, payouts = 0, income = 0;
  db.sessions.forEach(s=>{ const r = sessionNet(s); turnover += r.dep; payouts += r.net; income += r.income; });
  return { turnover, payouts, income, count: db.sessions.length };
}
function bacStats(){
  let turnover = 0, payouts = 0, income = 0;
  db.baccarat.forEach(b=>{ const r = bacCalc(b); turnover += b.sum; payouts += r.payout; income += r.casino; });
  return { turnover, payouts, income, count: db.baccarat.length };
}
function onlineStats(){
  let income = 0, expense = 0;
  db.online.forEach(o=>{
    const note = (o.note || '').toLowerCase();
    // бонусы за ранг / подарки / daily — не доход
    if (note.includes('бонус') || note.includes('ранг') || note.includes('daily') || note.includes('подарок')) return;
    if(o.type === 'доход') income += parseFloat(o.sum) || 0;
    else expense += parseFloat(o.sum) || 0;
  });
  return { income, expense, net: income - expense };
}

function renderDash(){
  const bj = bjStats(), bac = bacStats(), on = onlineStats();

  let totalDeposits = 0;
  db.deposits.forEach(d => {
    if (d.status === 'approved') totalDeposits += parseFloat(d.sum) || 0;
  });

  const onlineIncome = on.net;
  const totalIncome = bj.income + bac.income + onlineIncome;

  document.getElementById('dashCards').innerHTML = `
    <div class="card"><div class="label">Доход Блэкджека</div><div class="value green">${fmt(bj.income)} ₽</div></div>
    <div class="card"><div class="label">Доход Баккары</div><div class="value green">${fmt(bac.income)} ₽</div></div>
    <div class="card"><div class="label">Доход Crash (онлайн)</div><div class="value accent">${fmt(onlineIncome)} ₽</div></div>
    <div class="card"><div class="label">Депозиты (оборот)</div><div class="value" style="color:var(--muted)">${fmt(totalDeposits)} ₽</div></div>
    <div class="card" style="border-color: var(--gold);"><div class="label">Общий доход</div><div class="value gold">${fmt(totalIncome)} ₽</div></div>
  `;

  drawChart();
  renderIncomeCalendar();
  renderSessionsUnderChart();
}

function renderIncomeCalendar(){
  const days = {};
  function ensureDay(date) {
    if (!days[date]) days[date] = { bj: 0, bac: 0, crash: 0, dep: 0, commission: 0, salaries: 0 };
    return days[date];
  }
  (db.sessions || []).forEach(s => { if (!s.date) return; ensureDay(s.date).bj += sessionNet(s).income; });
  (db.baccarat || []).forEach(b => { if (!b.date) return; ensureDay(b.date).bac += bacCalc(b).casino; });
  (db.online || []).forEach(o => {
    if (!o.date) return;
    const note = (o.note || '').toLowerCase();
    if (note.includes('бонус') || note.includes('ранг') || note.includes('daily') || note.includes('подарок')) return;
    const inc = o.type === 'доход' ? (parseFloat(o.sum) || 0) : -(parseFloat(o.sum) || 0);
    ensureDay(o.date).crash += inc;
  });
  (db.deposits || []).forEach(d => { if (!d.date) return; if (d.status === 'approved') ensureDay(d.date).dep += parseFloat(d.sum) || 0; });
  (db.withdrawals || []).forEach(w => {
    if (!w.date) return;
    if (w.status === 'approved') {
      const sum = parseFloat(w.sum) || 0;
      const fee = parseFloat(w.fee) || Math.round(sum * 0.07 * 100) / 100;
      ensureDay(w.date).commission += fee;
    }
  });
  (db.payouts || []).forEach(p => { if (!p.date) return; ensureDay(p.date).salaries += parseFloat(p.sum) || 0; });

  const calendar = document.getElementById('incomeCalendar');
  const empty = document.getElementById('incomeCalendarEmpty');
  const summaryBadge = document.getElementById('incSummaryBadge');
  const daysCount = document.getElementById('incDaysCount');

  const allDates = Object.keys(days).sort();
  if (allDates.length === 0) {
    calendar.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (summaryBadge) summaryBadge.textContent = '';
    if (daysCount) daysCount.textContent = '0';
    return;
  }
  if (empty) empty.style.display = 'none';

  let grandTotal = 0;
  allDates.forEach(d => {
    const g = days[d];
    grandTotal += (g.bj + g.bac + g.crash) - g.commission - g.salaries;
  });

  if (summaryBadge) {
    summaryBadge.textContent = (grandTotal >= 0 ? '+' : '') + fmt(grandTotal) + ' ₽';
    summaryBadge.style.color = grandTotal >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (daysCount) daysCount.textContent = allDates.length;

  const dayValues = allDates.map(date => {
    const g = days[date];
    return (g.bj + g.bac + g.crash) - g.commission - g.salaries;
  });

  const maxAbs = Math.max(...dayValues.map(Math.abs), 1);

  calendar.innerHTML = allDates.map((date, i) => {
    const net = dayValues[i];
    const [y, m, dd] = date.split('-');
    let cls = 'zero';
    if (net !== 0) {
      const ratio = Math.abs(net) / maxAbs;
      let level;
      if (ratio < 0.15) level = 1;
      else if (ratio < 0.4) level = 2;
      else if (ratio < 0.7) level = 3;
      else level = 4;
      cls = (net > 0 ? 'pos-' : 'neg-') + level;
    }
    return `<div class="inc-cell ${cls}" 
                 data-date="${date}"
                 data-bj="${days[date].bj.toFixed(2)}"
                 data-bac="${days[date].bac.toFixed(2)}"
                 data-crash="${days[date].crash.toFixed(2)}"
                 data-dep="${days[date].dep.toFixed(2)}"
                 data-comm="${days[date].commission.toFixed(2)}"
                 data-sal="${days[date].salaries.toFixed(2)}"
                 data-net="${net.toFixed(2)}">${dd}</div>`;
  }).join('');

  bindCalendarTooltips();
}

function bindCalendarTooltips(){
  let tooltip = document.getElementById('incGlobalTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'incGlobalTooltip';
    tooltip.className = 'inc-tooltip';
    document.body.appendChild(tooltip);
  }
  document.querySelectorAll('.inc-cell').forEach(cell => {
    cell.addEventListener('mouseenter', () => {
      const date = cell.dataset.date;
      const net = parseFloat(cell.dataset.net) || 0;
      const [y, m, dd] = date.split('-');
      tooltip.innerHTML = `
        <div class="tt-date">${dd}.${m}.${y}</div>
        <div class="tt-total ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmt(net)} ₽</div>
        <div class="tt-row"><span>Блэкджек</span><span class="${parseFloat(cell.dataset.bj) >= 0 ? 'pos' : 'neg'}">${parseFloat(cell.dataset.bj) >= 0 ? '+' : ''}${fmt(cell.dataset.bj)} ₽</span></div>
        <div class="tt-row"><span>Баккара</span><span class="${parseFloat(cell.dataset.bac) >= 0 ? 'pos' : 'neg'}">${parseFloat(cell.dataset.bac) >= 0 ? '+' : ''}${fmt(cell.dataset.bac)} ₽</span></div>
        <div class="tt-row"><span>Crash</span><span class="${parseFloat(cell.dataset.crash) >= 0 ? 'pos' : 'neg'}">${parseFloat(cell.dataset.crash) >= 0 ? '+' : ''}${fmt(cell.dataset.crash)} ₽</span></div>
        <div class="tt-row"><span>Депозиты (оборот)</span><span style="color:var(--muted)">${fmt(cell.dataset.dep)} ₽</span></div>
        <div class="tt-row"><span>Комиссии 7%</span><span class="neg">−${fmt(cell.dataset.comm)} ₽</span></div>
        <div class="tt-row"><span>Зарплаты</span><span class="neg">−${fmt(cell.dataset.sal)} ₽</span></div>
      `;
      tooltip.classList.add('show');
      const rect = cell.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - 100;
      let top = rect.top - tooltip.offsetHeight - 10;
      if (top < 10) top = rect.bottom + 10;
      if (left + 200 > window.innerWidth - 10) left = window.innerWidth - 210;
      if (left < 10) left = 10;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    });
    cell.addEventListener('mouseleave', () => { tooltip.classList.remove('show'); });
    cell.addEventListener('click', () => { openDayIncomeModal(cell.dataset.date); });
  });
}

function openDayIncomeModal(date){
  const [y, m, dd] = date.split('-');
  const dateStr = `${dd}.${m}.${y}`;
  const bjSessions = (db.sessions || []).filter(s => s.date === date);
  const bacSessions = (db.baccarat || []).filter(b => b.date === date);
  const crashRounds = (db.online || []).filter(o => o.date === date && (o.note || '').startsWith('Crash Round'));
  const depApproved = (db.deposits || []).filter(d => d.date === date && d.status === 'approved');
  const wdApproved = (db.withdrawals || []).filter(w => w.date === date && w.status === 'approved');
  const payoutsDay = (db.payouts || []).filter(p => p.date === date);

  let bjTotal = 0, bacTotal = 0, crashTotal = 0, depTotal = 0, commTotal = 0, salTotal = 0;
  bjSessions.forEach(s => bjTotal += sessionNet(s).income);
  bacSessions.forEach(b => bacTotal += bacCalc(b).casino);
  crashRounds.forEach(o => {
    if (o.type === 'доход') crashTotal += parseFloat(o.sum) || 0;
    else crashTotal -= parseFloat(o.sum) || 0;
  });
  depApproved.forEach(d => depTotal += parseFloat(d.sum) || 0);
  wdApproved.forEach(w => {
    const sum = parseFloat(w.sum) || 0;
    commTotal += parseFloat(w.fee) || Math.round(sum * 0.07 * 100) / 100;
  });
  payoutsDay.forEach(p => salTotal += parseFloat(p.sum) || 0);

  const net = (bjTotal + bacTotal + crashTotal) - commTotal - salTotal;

  let html = `
    <div class="day-modal-title">${dateStr}</div>
    <div class="day-modal-sub">Отчёт за день</div>
    <div class="day-modal-total ${net >= 0 ? 'pos' : 'neg'}" style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'};">${net >= 0 ? '+' : ''}${fmt(net)} ₽</div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>🎲 Блэкджек (${bjSessions.length} сессий)</span>
        <span class="amt ${bjTotal >= 0 ? 'pos' : 'neg'}">${bjTotal >= 0 ? '+' : ''}${fmt(bjTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${bjSessions.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет сессий</div>' :
          bjSessions.map(s => {
            const r = sessionNet(s);
            return `<div class="day-list-item">
              <span class="who">${s.nick || '—'} · ставка ${fmt(r.dep)} ₽ · дилер ${s.dealer || '—'}</span>
              <span class="val ${r.income >= 0 ? 'pos' : 'neg'}">${r.income >= 0 ? '+' : ''}${fmt(r.income)} ₽</span>
            </div>`;
          }).join('')
        }
      </div>
    </div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>🎴 Баккара (${bacSessions.length} сессий)</span>
        <span class="amt ${bacTotal >= 0 ? 'pos' : 'neg'}">${bacTotal >= 0 ? '+' : ''}${fmt(bacTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${bacSessions.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет сессий</div>' :
          bacSessions.map(b => {
            const r = bacCalc(b);
            return `<div class="day-list-item">
              <span class="who">${b.player || '—'} · ставка ${fmt(b.sum)} ₽ · дилер ${b.dealer || '—'}</span>
              <span class="val ${r.casino >= 0 ? 'pos' : 'neg'}">${r.casino >= 0 ? '+' : ''}${fmt(r.casino)} ₽</span>
            </div>`;
          }).join('')
        }
      </div>
    </div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>🚀 Crash (${crashRounds.length} раундов)</span>
        <span class="amt ${crashTotal >= 0 ? 'pos' : 'neg'}">${crashTotal >= 0 ? '+' : ''}${fmt(crashTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${crashRounds.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет раундов</div>' :
          crashRounds.map(o => {
            const val = o.type === 'доход' ? (parseFloat(o.sum) || 0) : -(parseFloat(o.sum) || 0);
            return `<div class="day-list-item">
              <span class="who">${o.note || '—'}</span>
              <span class="val ${val >= 0 ? 'pos' : 'neg'}">${val >= 0 ? '+' : ''}${fmt(val)} ₽</span>
            </div>`;
          }).join('')
        }
      </div>
    </div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>💰 Депозиты (${depApproved.length}) — оборот</span>
        <span class="amt" style="color:var(--muted)">${fmt(depTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${depApproved.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет депозитов</div>' :
          depApproved.map(d => `<div class="day-list-item">
            <span class="who">${d.nick || '—'}</span>
            <span class="val" style="color:var(--muted)">${fmt(d.sum)} ₽</span>
          </div>`).join('')
        }
      </div>
    </div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>💳 Комиссии 7% (${wdApproved.length} выводов)</span>
        <span class="amt neg">−${fmt(commTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${wdApproved.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет выводов</div>' :
          wdApproved.map(w => {
            const sum = parseFloat(w.sum) || 0;
            const fee = parseFloat(w.fee) || Math.round(sum * 0.07 * 100) / 100;
            return `<div class="day-list-item">
              <span class="who">${w.nick || '—'} · вывод ${fmt(sum)} ₽</span>
              <span class="val neg">−${fmt(fee)} ₽</span>
            </div>`;
          }).join('')
        }
      </div>
    </div>
  `;
  html += `
    <div class="day-section">
      <div class="day-section-title">
        <span>👔 Зарплаты дилерам (${payoutsDay.length})</span>
        <span class="amt neg">−${fmt(salTotal)} ₽</span>
      </div>
      <div class="day-list">
        ${payoutsDay.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:8px;">Нет выплат</div>' :
          payoutsDay.map(p => `<div class="day-list-item">
            <span class="who">${p.dealer || '—'} ${p.note ? '· ' + p.note : ''}</span>
            <span class="val neg">−${fmt(p.sum)} ₽</span>
          </div>`).join('')
        }
      </div>
    </div>
  `;
  html += `<div style="text-align:center;margin-top:20px"><button class="ghost" onclick="closeDayIncomeModal()" style="width:100%">Закрыть</button></div>`;
  document.getElementById('dayIncomeContent').innerHTML = html;
  document.getElementById('dayIncomeModal').classList.add('show');
}

function closeDayIncomeModal(){ document.getElementById('dayIncomeModal').classList.remove('show'); }

function renderSessionsUnderChart(){
  const bj = [...db.sessions].sort((a,b) => {
    const da = a.created_at ? new Date(a.created_at) : new Date(a.date || 0);
    const dbb = b.created_at ? new Date(b.created_at) : new Date(b.date || 0);
    return dbb - da;
  }).slice(0, 50);
  document.getElementById('bjCount').textContent = db.sessions.length;
  const bjBody = document.getElementById('bjSessionsBody');
  if(bj.length === 0){
    bjBody.innerHTML = '<tr class="empty-row"><td colspan="5">Пока нет сессий</td></tr>';
  } else {
    bjBody.innerHTML = bj.map(s => {
      const r = sessionNet(s);
      const time = s.created_at ? new Date(s.created_at).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : (s.date || '—');
      const winCls = r.net > 0 ? 'pos' : (r.net < 0 ? 'neg' : '');
      return `<tr><td>${s.nick || '—'}</td><td>${fmt(r.dep)} ₽</td><td class="${winCls}">${fmt(r.net)} ₽</td><td>${s.dealer || '—'}</td><td style="color:var(--muted);font-size:11px">${time}</td></tr>`;
    }).join('');
  }
  const bac = [...db.baccarat].sort((a,b) => {
    const da = a.created_at ? new Date(a.created_at) : new Date(a.date || 0);
    const dbb = b.created_at ? new Date(b.created_at) : new Date(b.date || 0);
    return dbb - da;
  }).slice(0, 50);
  document.getElementById('bacCount').textContent = db.baccarat.length;
  const bacBody = document.getElementById('bacSessionsBody');
  if(bac.length === 0){
    bacBody.innerHTML = '<tr class="empty-row"><td colspan="5">Пока нет сессий</td></tr>';
  } else {
    bacBody.innerHTML = bac.map(b => {
      const r = bacCalc(b);
      const time = b.created_at ? new Date(b.created_at).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : (b.date || '—');
      const winCls = r.payout > 0 ? 'pos' : (r.payout < 0 ? 'neg' : '');
      return `<tr><td>${b.player || '—'}</td><td>${fmt(b.sum)} ₽</td><td class="${winCls}">${fmt(r.payout)} ₽</td><td>${b.dealer || '—'}</td><td style="color:var(--muted);font-size:11px">${time}</td></tr>`;
    }).join('');
  }
}

function drawChart(){
  const canvas = document.getElementById('incomeChart');
  if(!canvas) return;
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  const map = {};
  db.sessions.forEach(s=>{ if(!s.date) return; if(!map[s.date]) map[s.date]=0; map[s.date]+=sessionNet(s).income; });
  db.baccarat.forEach(b=>{ if(!b.date) return; if(!map[b.date]) map[b.date]=0; map[b.date]+=bacCalc(b).casino; });
  db.online.forEach(o=>{
    if(!o.date) return;
    const note = (o.note || '').toLowerCase();
    if (note.includes('бонус') || note.includes('ранг') || note.includes('daily') || note.includes('подарок')) return;
    if(!map[o.date]) map[o.date]=0;
    if(o.type === 'доход') map[o.date]+=parseFloat(o.sum)||0; else map[o.date]-=parseFloat(o.sum)||0;
  });
  const dates = Object.keys(map).sort();
  if(!dates.length){
    ctx.fillStyle = '#a0aec0'; ctx.font = '14px Montserrat';
    ctx.textAlign = 'center'; ctx.fillText('Нет данных для графика', W/2, H/2); return;
  }
  let runningTotal = 0;
  const values = dates.map(d => { runningTotal += map[d]; return runningTotal; });
  const padL = 60, padR = 20, padT = 20, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(1, ...values);
  const minVal = Math.min(0, ...values);
  const range = maxVal - minVal || 1;
  const y = v => padT + plotH - ((v - minVal) / range) * plotH;
  const x = i => padL + (dates.length === 1 ? plotW/2 : (i/(dates.length-1))*plotW);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  ctx.fillStyle = '#a0aec0'; ctx.font = '11px Montserrat'; ctx.textAlign = 'right';
  for(let i=0; i<=4; i++){
    const v = minVal + (range/4)*i;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W-padR, yy); ctx.stroke();
    ctx.fillText(Math.round(v).toLocaleString('ru-RU'), padL-10, yy+4);
  }
  ctx.fillStyle = '#a0aec0'; ctx.font = '11px Montserrat'; ctx.textAlign = 'center';
  const step = Math.ceil(dates.length / 7);
  dates.forEach((d,i)=>{
    if(i % step === 0 || i === dates.length-1){
      const [yy,mm,dd] = d.split('-');
      ctx.fillText(dd+'.'+mm, x(i), H-15);
    }
  });
  ctx.beginPath();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(0,229,255,0.5)';
  values.forEach((v, i) => { const xx = x(i), yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
  ctx.stroke();
  ctx.shadowBlur = 0;
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);
  ctx.beginPath(); ctx.fillStyle = '#00e5ff'; ctx.arc(lastX, lastY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(0,229,255,0.8)';
  ctx.beginPath(); ctx.arc(lastX, lastY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

function renderFinance(){
  document.getElementById('depositsBody').innerHTML = db.deposits.map(d=>`
    <tr><td>${d.date}</td><td>${d.nick}<br><span style="font-size:11px;color:#a0aec0">${d.email||''}</span></td>
      <td>${fmt(d.sum)} ₽</td><td><span class="status ${d.status}">${d.status}</span></td>
      <td>${d.status==='pending' ? `<button class="success small" onclick="depAction(${d.id},'approved')">Зачислить</button><button class="danger small" onclick="depAction(${d.id},'rejected')">Отклонить</button>` : `<button class="ghost small" onclick="delDeposit(${d.id})">Удалить</button>`}</td></tr>`).join('');
  document.getElementById('depositsEmpty').style.display = db.deposits.length ? 'none' : 'block';
  document.getElementById('withdrawalsBody').innerHTML = db.withdrawals.map(w=>`
    <tr><td>${w.date}</td><td>${w.nick}<br><span style="font-size:11px;color:#a0aec0">${w.email||''}</span></td>
      <td>${fmt(w.sum)} ₽</td><td>${fmt(w.fee)} ₽</td><td>${fmt(w.net)} ₽</td>
      <td><span class="status ${w.status}">${w.status}</span></td>
      <td>${w.status==='pending' ? `<button class="success small" onclick="wdAction(${w.id},'approved')">Выплатить</button><button class="ghost small" onclick="wdAction(${w.id},'hold')">Отложить</button><button class="danger small" onclick="wdAction(${w.id},'rejected')">Отклонить</button>` : w.status==='hold' ? `<button class="success small" onclick="wdAction(${w.id},'approved')">Выплатить</button><button class="danger small" onclick="wdAction(${w.id},'rejected')">Отклонить</button>` : `<button class="ghost small" onclick="delWithdrawal(${w.id})">Удалить</button>`}</td></tr>`).join('');
  document.getElementById('withdrawalsEmpty').style.display = db.withdrawals.length ? 'none' : 'block';
}
async function depAction(id, status){ await apiPut('/api/deposits/'+id, {status}); await audit('deposit_'+status, '#'+id); await loadDB(); renderFinance(); }
async function wdAction(id, status){ await apiPut('/api/withdrawals/'+id, {status}); await audit('withdrawal_'+status, '#'+id); await loadDB(); renderFinance(); }
async function delDeposit(id){ await apiDelete('/api/deposits/'+id); await loadDB(); renderFinance(); }
async function delWithdrawal(id){ await apiDelete('/api/withdrawals/'+id); await loadDB(); renderFinance(); }

function renderPlayers(){
  const names = new Set();
  db.sessions.forEach(s=>{ if(s.nick) names.add(s.nick); });
  db.baccarat.forEach(b=>{ if(b.player) names.add(b.player); });
  const list = [...names];
  let total = 0;
  document.getElementById('playersBody').innerHTML = list.map((nick,i)=>{
    const bj = db.sessions.filter(s=>s.nick===nick).reduce((a,s)=>a+sessionNet(s).income, 0);
    const bac = db.baccarat.filter(b=>b.player===nick).reduce((a,b)=>a+bacCalc(b).casino, 0);
    const sum = bj + bac;
    total += sum;
    const p = db.players.find(x=>x.nick===nick) || {};
    return `<tr><td>${i+1}</td><td>${nick}</td>
      <td class="${bj>=0?'pos':'neg'}">${bj>=0?'+':''}${fmt(bj)} ₽</td>
      <td class="${bac>=0?'pos':'neg'}">${bac>=0?'+':''}${fmt(bac)} ₽</td>
      <td class="${sum>=0?'pos':'neg'}">${sum>=0?'+':''}${fmt(sum)} ₽</td>
      <td>${p.vip?'VIP':'—'}</td>
      <td><button class="ghost small" onclick="toggleVIP('${nick.replace(/'/g,"\\'")}', ${!p.vip})">VIP</button></td></tr>`;
  }).join('');
  document.getElementById('playersEmpty').style.display = list.length ? 'none' : 'block';
  document.getElementById('playerCards').innerHTML = `
    <div class="card"><div class="label">Игроков</div><div class="value accent">${list.length}</div></div>
    <div class="card"><div class="label">Общий проигрыш</div><div class="value ${total>=0?'green':'red'}">${fmt(total)} ₽</div></div>`;
}
async function toggleVIP(nick, val){ await apiPost('/api/players', {nick, vip:val}); await audit('vip_toggle', nick); await loadDB(); renderPlayers(); }

function renderOnline() {
  const cashouts = db.crash_bets.filter(b => b.cashed_out);
  const totalBets = db.crash_bets.reduce((a, b) => a + (parseFloat(b.amount) || 0), 0);
  const totalPayouts = cashouts.reduce((a, b) => a + (parseFloat(b.amount) * parseFloat(b.cashout_mult) || 0), 0);
  document.getElementById('onlineCards').innerHTML = `
    <div class="card"><div class="label">Всего ставок в Crash</div><div class="value accent">${fmt(totalBets)} ₽</div></div>
    <div class="card"><div class="label">Выигрыши (Кэшауты)</div><div class="value red">${fmt(totalPayouts)} ₽</div></div>
    <div class="card"><div class="label">Прибыль казино</div><div class="value green">${fmt(totalBets - totalPayouts)} ₽</div></div>
  `;
  document.getElementById('onlineBody').innerHTML = cashouts.map(b => {
    const dateStr = b.created_at ? new Date(b.created_at).toLocaleString('ru-RU') : '—';
    return `<tr>
        <td>${dateStr}</td>
        <td>${b.player_name}</td>
        <td>${fmt(b.amount)} ₽</td>
        <td class="pos">x${parseFloat(b.cashout_mult).toFixed(2)}</td>
        <td class="pos">${fmt(b.amount * parseFloat(b.cashout_mult))} ₽</td>
        <td>#${b.round_id}</td>
      </tr>`;
  }).join('');
  document.getElementById('onlineEmpty').style.display = cashouts.length ? 'none' : 'block';
}

async function loadCrashForceStatus() {
  try {
    const r = await fetch('/api/admin/crash/force-next');
    const data = await r.json();
    const el = document.getElementById('crashForceStatus');
    if (!el) return;
    if (data.value && data.value > 0) {
      el.innerHTML = `<span style="color:var(--gold); font-weight:900;">⚠ Активно: следующий краш на x${data.value.toFixed(2)}</span>`;
      document.getElementById('crashForceInput').value = data.value;
    } else {
      el.innerHTML = '<span style="color:var(--muted);">Форсированный краш не задан</span>';
    }
  } catch(e) {}
}

async function setCrashForce() {
  const val = parseFloat(document.getElementById('crashForceInput').value);
  if (!isFinite(val) || val < 1 || val > 1000) { alert('Введите число от 1.00 до 1000'); return; }
  const pass = prompt('Пароль owner:');
  if (pass === null) return;
  try {
    const r = await fetch('/api/admin/crash/force-next', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ value: val, pass })
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error || 'Ошибка'); return; }
    document.getElementById('crashForceStatus').innerHTML =
      `<span style="color:var(--gold); font-weight:900;">✓ Следующий краш будет на x${val.toFixed(2)}</span>`;
    await audit('crash_force', 'x' + val.toFixed(2));
  } catch(e) { alert('Ошибка соединения'); }
}

async function clearCrashForce() {
  const pass = prompt('Пароль owner:');
  if (pass === null) return;
  try {
    const r = await fetch('/api/admin/crash/clear-force', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ pass })
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error || 'Ошибка'); return; }
    document.getElementById('crashForceStatus').innerHTML =
      `<span style="color:var(--green);">Форсированный краш сброшен</span>`;
    document.getElementById('crashForceInput').value = '';
    await audit('crash_force_clear', '');
  } catch(e) { alert('Ошибка соединения'); }
}

async function loadGuests(){
  db.guests = await apiGet('/api/guests');
  const body = document.getElementById('guestsBody');
  const todayS = today();
  body.innerHTML = db.guests.map(g => {
    const streak = parseInt(g.streak) || 0;
    const streakCls = streak >= 7 ? 'max' : streak >= 3 ? 'hot' : '';
    const lastVisit = g.last_visit ? String(g.last_visit).slice(0,16).replace('T',' ') : '—';
    const spun = g.last_wheel_spin && String(g.last_wheel_spin).slice(0,10) === todayS;
    return `<tr>
      <td>${g.id}</td>
      <td>${g.name}</td>
      <td><span class="rank-pill ${g.rank}">${g.rank}</span></td>
      <td>${g.points||0}</td>
      <td>${g.visits||0}</td>
      <td class="pos">${fmt(parseFloat(g.deposit_balance)||0)} ₽</td>
      <td class="gold">${fmt(parseFloat(g.bonus_balance)||0)} ₽</td>
      <td><span class="streak-badge ${streakCls}">🔥 ${streak}</span></td>
      <td style="font-size:12px;color:var(--muted)">${lastVisit}</td>
      <td>${spun ? '<span class="dot-yes">✓</span>' : '<span class="dot-no">—</span>'}</td>
      <td>
        <button class="ghost small" onclick="printOneGuest('${g.id}')" title="Печать 6 карт">🖨</button>
        <button class="gold small" onclick="withdrawGuest('${g.id}')" title="Вывести бонусы">₽</button>
        <button class="ghost small" onclick="openEditGuest('${g.id}')" title="Редактировать">✏️</button>
        <button class="danger small" onclick="delGuest('${g.id}')">Удалить</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('guestsEmpty').style.display = db.guests.length ? 'none' : 'block';
}

function printOneGuest(id){
  const base = localStorage.getItem('kingwin_base_url') || (location.protocol.startsWith('http') ? location.origin : 'http://192.168.0.11:3000');
  window.open(base + '/cards_print.html?id=' + encodeURIComponent(id), '_blank');
}

function withdrawGuest(id){
  const g = db.guests.find(x => String(x.id) === String(id));
  if(!g){ showInfo('Ошибка', 'Гость не найден'); return; }
  const balance = (parseFloat(g.bonus_balance) || 0) + (parseFloat(g.deposit_balance) || 0);
  if(balance <= 0){ showInfo('Ошибка', 'У гостя нет средств'); return; }
  const input = prompt(`Сколько вывести гостю "${g.name}"? (доступно ${fmt(balance)} ₽)`, fmt(balance));
  const amt = parseFloat(input) || 0;
  if(amt <= 0) return;
  if(amt > balance){ showInfo('Ошибка', 'Недостаточно средств'); return; }
  showPass('Вывод средств', `Вывести <b>${fmt(amt)} ₽</b> гостю <b>${g.name}</b>?<br>Пароль владельца:`, async ()=>{
    await apiPost('/api/withdrawals', { date: today(), nick: g.name, email: '', sum: amt, fee: 0, net: amt, status: 'approved' });
    await apiPost('/api/guests/withdraw-deduct', { id: g.id, sum: amt });
    await audit('guest_withdraw', `${g.name}: ${amt} ₽`);
    await loadDB(); loadGuests();
    showInfo('Готово', `Выведено ${fmt(amt)} ₽ гостю ${g.name}`);
  });
}

function openEditGuest(id){
  const g = db.guests.find(x => String(x.id) === String(id));
  if(!g) return;
  editGuestId = g.id;
  document.getElementById('eg_name').value = g.name || '';
  document.getElementById('eg_rank').value = g.rank || 'Bronze';
  document.getElementById('eg_pass').value = g.pass || '1234';
  document.getElementById('eg_bonus_text').value = g.bonus_text || '';
  document.getElementById('eg_bonus_code').value = g.bonus_code || '';
  document.getElementById('eg_bonus_balance').value = parseFloat(g.bonus_balance) || 0;
  document.getElementById('eg_streak').value = parseInt(g.streak) || 0;
  document.getElementById('eg_err').textContent = '';
  document.getElementById('editGuestModal').classList.add('show');
}
function closeEditGuestModal(){ document.getElementById('editGuestModal').classList.remove('show'); editGuestId = null; }

async function saveEditGuest(){
  if(!editGuestId) return;
  const payload = {
    id: editGuestId,
    name: document.getElementById('eg_name').value.trim(),
    rank: document.getElementById('eg_rank').value,
    pass: document.getElementById('eg_pass').value.trim() || '1234',
    bonus_text: document.getElementById('eg_bonus_text').value.trim(),
    bonus_code: document.getElementById('eg_bonus_code').value.trim(),
    bonus_balance: parseFloat(document.getElementById('eg_bonus_balance').value) || 0,
    streak: parseInt(document.getElementById('eg_streak').value) || 0
  };
  if(!payload.name){ document.getElementById('eg_err').textContent = 'Имя обязательно'; return; }
  const r = await apiPost('/api/guests/update', payload);
  if(r.error){ document.getElementById('eg_err').textContent = r.error; return; }
  await audit('guest_edit', `#${editGuestId}`);
  closeEditGuestModal();
  await loadDB(); loadGuests();
  showInfo('Готово', 'Данные гостя обновлены');
}

async function addGuest(){
  const name = document.getElementById('g_name').value.trim();
  if(!name){ showInfo('Ошибка', 'Введите имя гостя'); return; }
  const data = {
    name: name,
    rank: document.getElementById('g_rank').value,
    pass: document.getElementById('g_pass').value.trim() || '1234',
    bonus_text: document.getElementById('g_bonus_text').value.trim(),
    bonus_code: document.getElementById('g_bonus_code').value.trim(),
    points: 0,
    visits: 0
  };
  await apiPost('/api/guests', data);
  await audit('guest_add', name);
  await loadGuests();
  ['g_name','g_bonus_text','g_bonus_code'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('g_pass').value = '1234';
  showInfo('Успех', 'Гость добавлен. Можно печатать карты!');
}

async function delGuest(id){
  if(!confirm('Удалить гостя?')) return;
  await apiPost('/api/guests/delete', { id });
  await audit('guest_del', '#'+id);
  await loadGuests();
  await loadDB();
}

function renderNewsAdmin(){
  const wrap = document.getElementById('newsList');
  if(!newsList.length){
    wrap.innerHTML = '';
    document.getElementById('newsEmpty').style.display = 'block';
    return;
  }
  document.getElementById('newsEmpty').style.display = 'none';
  wrap.innerHTML = newsList.map(n=>`
    <div class="news-edit-row">
      <div class="col">
        <input type="text" value="${(n.title||'').replace(/"/g,'&quot;')}" data-id="${n.id}" data-field="title">
        <textarea data-id="${n.id}" data-field="body">${escHtml(n.body||'')}</textarea>
        <input type="date" value="${(n.date||'').slice(0,10)}" data-id="${n.id}" data-field="date">
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        <button class="success small" onclick="saveNews(${n.id})">💾</button>
        <button class="danger small" onclick="delNews(${n.id})">✕</button>
      </div>
    </div>
  `).join('');
}
function escHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function addNews(){
  const title = document.getElementById('n_title').value.trim();
  const body = document.getElementById('n_body').value.trim();
  const date = document.getElementById('n_date').value || today();
  if(!title){ showInfo('Ошибка', 'Введите заголовок'); return; }
  const r = await apiPost('/api/admin/news', { title, body, date });
  if(r.error){ showInfo('Ошибка', r.error); return; }
  await audit('news_add', title);
  document.getElementById('n_title').value = '';
  document.getElementById('n_body').value = '';
  document.getElementById('n_date').value = '';
  await loadNewsList();
  renderNewsAdmin();
}

async function saveNews(id){
  const row = document.querySelector(`.news-edit-row input[data-id="${id}"]`).closest('.news-edit-row');
  const title = row.querySelector('input[data-field="title"]').value.trim();
  const body = row.querySelector('textarea[data-field="body"]').value.trim();
  const date = row.querySelector('input[data-field="date"]').value || today();
  const r = await apiPost('/api/admin/news/' + id, { title, body, date });
  if(r.error){ showInfo('Ошибка', r.error); return; }
  await loadNewsList();
  renderNewsAdmin();
  showInfo('Готово', 'Новость обновлена.');
}

async function delNews(id){
  if(!confirm('Удалить новость?')) return;
  await apiDelete('/api/admin/news/' + id);
  await loadNewsList();
  renderNewsAdmin();
}

function renderReviews(){
  const reviews = db.dealer_reviews || [];
  const ratings = db.dealer_ratings || [];
  const totalReviews = reviews.length;
  const avgAll = totalReviews ? (reviews.reduce((a, r) => a + (parseInt(r.stars) || 0), 0) / totalReviews) : 0;
  const uniqueDealers = ratings.length;
  document.getElementById('reviewCards').innerHTML = `
    <div class="card"><div class="label">Всего отзывов</div><div class="value accent">${totalReviews}</div></div>
    <div class="card"><div class="label">Средний рейтинг</div><div class="value gold">${avgAll.toFixed(2)} ⭐</div></div>
    <div class="card"><div class="label">Дилеров с оценками</div><div class="value green">${uniqueDealers}</div></div>
  `;
  document.getElementById('ratingsBody').innerHTML = ratings.map((r, i) => {
    const avg = parseFloat(r.avg_stars) || 0;
    const full = Math.round(avg);
    const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
    return `<tr><td>${i+1}</td><td style="text-transform:capitalize;">${r.dealer}</td><td><span class="star-line">${stars}</span> <b>${avg.toFixed(2)}</b></td><td>${r.reviews_count}</td></tr>`;
  }).join('');
  document.getElementById('ratingsEmpty').style.display = ratings.length ? 'none' : 'block';
  document.getElementById('reviewsBody').innerHTML = reviews.map(rv => {
    const stars = '★'.repeat(parseInt(rv.stars) || 0) + '☆'.repeat(5 - (parseInt(rv.stars) || 0));
    const date = rv.created_at ? new Date(rv.created_at).toLocaleString('ru-RU') : (rv.date || '—');
    return `<tr>
      <td>${date}</td>
      <td>${rv.guest_name || '—'}<br><span style="font-size:11px;color:#a0aec0">${rv.guest_id || ''}</span></td>
      <td style="text-transform:capitalize;">${rv.dealer_name}</td>
      <td><span class="star-line">${stars}</span></td>
      <td style="white-space:normal; max-width:300px;">${escHtml(rv.comment || '—')}</td>
      <td><button class="danger small" onclick="delReview(${rv.id})">Удалить</button></td>
    </tr>`;
  }).join('');
  document.getElementById('reviewsEmpty').style.display = reviews.length ? 'none' : 'block';
}

async function delReview(id){
  if(!confirm('Удалить отзыв?')) return;
  await apiDelete('/api/dealer-reviews/' + id);
  await loadDB();
  renderReviews();
}

function dealerNames(){
  const set = new Set();
  db.sessions.forEach(s=>{ if(s.dealer && s.dealer!=='—') set.add(s.dealer); });
  db.baccarat.forEach(b=>{ if(b.dealer && b.dealer!=='—') set.add(b.dealer); });
  db.payouts.forEach(p=>{ if(p.dealer) set.add(p.dealer); });
  return [...set];
}
function dealerStats(name){
  const s = db.sessions.filter(x=>x.dealer===name);
  const b = db.baccarat.filter(x=>x.dealer===name);
  const income = s.reduce((a,x)=>a+sessionNet(x).income,0) + b.reduce((a,x)=>a+bacCalc(x).casino,0);
  const accrued = Math.round(income * 10 / 100 * 100) / 100;
  const paid = db.payouts.filter(p=>p.dealer===name).reduce((a,p)=>a+(parseFloat(p.sum)||0),0);
  return { sessions: s.length + b.length, income, accrued, paid, remaining: Math.round((accrued-paid)*100)/100 };
}

async function loadCashSafeAdmin() {
  try {
    const r = await fetch('/api/admin/cash-safe');
    const data = await r.json();
    const body = document.getElementById('safeBody');
    const empty = document.getElementById('safeEmpty');
    if (!data.dealers || data.dealers.length === 0) { body.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    body.innerHTML = data.dealers.map(d => `
      <tr>
        <td><b>${d.dealer_name || '—'}</b></td>
        <td style="color:var(--accent); font-weight:900;">${fmt(d.open_total)} ₽</td>
        <td style="color:var(--gold); font-weight:900;">${fmt(d.handed_total)} ₽</td>
        <td>${d.handed_cnt > 0 ? `<button class="success small" onclick="acceptCash(${d.dealer_id}, ${d.handed_total})">✓ Принять</button>` : '—'}</td>
      </tr>
    `).join('');
  } catch(e) {}
}

async function acceptCash(dealerId, expectedSum) {
  const realStr = prompt(`Сколько реально в сейфе? (ожидается ${fmt(expectedSum)} ₽)`, fmt(expectedSum));
  if (realStr === null) return;
  const realSum = parseFloat(realStr.replace(/\s/g, '').replace(',', '.')) || 0;
  if (realSum < 0) return;
  const pass = prompt('Пароль owner:');
  if (pass === null) return;
  try {
    const r = await fetch('/api/admin/cash-accept', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ dealer_id: dealerId, real_sum: realSum, pass })
    });
    const data = await r.json();
    if (!r.ok) { showInfo('Ошибка', data.error || 'Ошибка'); return; }
    const diff = data.diff;
    let msg = `Ожидалось: ${fmt(data.expected)} ₽<br>Реально: ${fmt(data.real_sum)} ₽<br>`;
    if (Math.abs(diff) < 0.01) msg += '<b style="color:var(--green)">✓ Сошлось!</b>';
    else if (diff < 0) msg += `<b style="color:var(--red)">⚠ Недостача: ${fmt(Math.abs(diff))} ₽</b>`;
    else msg += `<b style="color:var(--gold)">⚠ Излишек: ${fmt(diff)} ₽</b>`;
    showInfo('Сейф принят', msg);
    loadCashSafeAdmin();
  } catch(e) { showInfo('Ошибка', 'Ошибка соединения'); }
}

async function loadChipsReport() {
  const dateInput = document.getElementById('chipsDateInput');
  const date = dateInput.value || today();
  try {
    const r = await fetch('/api/admin/chips-summary?date=' + encodeURIComponent(date));
    const data = await r.json();
    const cards = document.getElementById('chipsCards');
    if (cards) {
      cards.innerHTML = `
        <div class="card"><div class="label">🎰 Выдано</div><div class="value accent">${fmt(data.grandIn)} ₽</div></div>
        <div class="card"><div class="label">🔄 Принято</div><div class="value" style="color:var(--gold);">${fmt(data.grandOut)} ₽</div></div>
        <div class="card" style="border-color:${data.grandProfit >= 0 ? 'var(--green)' : 'var(--red)'};">
          <div class="label">💰 Прибыль</div>
          <div class="value" style="color:${data.grandProfit >= 0 ? 'var(--green)' : 'var(--red)'};">${data.grandProfit >= 0 ? '+' : ''}${fmt(data.grandProfit)} ₽</div>
        </div>
      `;
    }
    const body = document.getElementById('chipsReportBody');
    const empty = document.getElementById('chipsReportEmpty');
    if (!data.dealers || data.dealers.length === 0) { body.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    body.innerHTML = data.dealers.map(d => {
      const profitColor = d.profit >= 0 ? 'var(--green)' : 'var(--red)';
      return `<tr><td><b>${d.dealer_name || '—'}</b></td><td style="color:var(--green);">${fmt(d.totalIn)} ₽</td><td style="color:var(--gold);">${fmt(d.totalOut)} ₽</td><td style="font-weight:900; color:${profitColor};">${d.profit >= 0 ? '+' : ''}${fmt(d.profit)} ₽</td></tr>`;
    }).join('');
  } catch(e) { console.error(e); }
}

function renderPayouts(){
  const names = dealerNames();
  let tAcc=0, tPaid=0;
  document.getElementById('accruedBody').innerHTML = names.map((n,i)=>{
    const s = dealerStats(n);
    tAcc += s.accrued; tPaid += s.paid;
    return `<tr><td>${i+1}</td><td>${n}</td><td>${s.sessions}</td><td>${fmt(s.income)} ₽</td><td class="pos">${fmt(s.accrued)} ₽</td><td>${fmt(s.paid)} ₽</td><td class="${s.remaining>0?'red':'green'}">${fmt(s.remaining)} ₽</td></tr>`;
  }).join('');
  document.getElementById('accruedEmpty').style.display = names.length ? 'none' : 'block';
  document.getElementById('payoutCards').innerHTML = `
    <div class="card"><div class="label">Дилеров</div><div class="value accent">${names.length}</div></div>
    <div class="card"><div class="label">Начислено</div><div class="value accent">${fmt(tAcc)} ₽</div></div>
    <div class="card"><div class="label">Выплачено</div><div class="value green">${fmt(tPaid)} ₽</div></div>
    <div class="card"><div class="label">Остаток</div><div class="value ${(tAcc-tPaid)>0?'red':'green'}">${fmt(tAcc-tPaid)} ₽</div></div>`;
  document.getElementById('payoutBody').innerHTML = db.payouts.map(p=>`<tr><td>${p.id}</td><td>${p.date}</td><td>${p.dealer}</td><td>${fmt(p.sum)} ₽</td><td>${p.note||'—'}</td><td><button class="danger small" onclick="delPayout(${p.id})">Удалить</button></td></tr>`).join('');
  document.getElementById('payoutEmpty').style.display = db.payouts.length ? 'none' : 'block';
  const chipsDateInput = document.getElementById('chipsDateInput');
  if (chipsDateInput && !chipsDateInput.value) chipsDateInput.value = today();
  loadChipsReport();
  loadCashSafeAdmin();
}

function openPayoutModal(){
  const dealer = document.getElementById('pay_dealer').value.trim();
  const sum = parseFloat(document.getElementById('pay_sum').value) || 0;
  if(!dealer || sum<=0){ showInfo('Ошибка', 'Заполни дилера и сумму'); return; }
  showPass('Выдача зарплаты', `Выдать <b>${sum} ₽</b> дилеру <b>${dealer}</b>?<br>Пароль владельца:`, async ()=>{
    const date = document.getElementById('pay_date').value || today();
    const note = document.getElementById('pay_note').value.trim();
    await apiPost('/api/payouts', { date, dealer, sum, note });
    await audit('payout_add', `${dealer}: ${sum} ₽`);
    await loadDB(); renderPayouts();
    ['pay_dealer','pay_sum','pay_note'].forEach(id=>document.getElementById(id).value='');
    showInfo('Готово', `Выплачено <b>${sum} ₽</b> дилеру <b>${dealer}</b>.`);
  });
}
async function delPayout(id){ await apiDelete('/api/payouts/'+id); await loadDB(); renderPayouts(); }

function renderHistory(){
  document.getElementById('historyBody').innerHTML = db.audit.map(a=>`<tr><td>${a.time}</td><td>${a.user_name}</td><td>${a.action}</td><td>${a.details}</td></tr>`).join('');
  document.getElementById('historyEmpty').style.display = db.audit.length ? 'none' : 'block';
}
async function clearHistory(){ await apiDelete('/api/audit'); await loadDB(); renderHistory(); }

function renderRoles(){
  document.getElementById('rolesBody').innerHTML = db.employees.map((e,i)=>`
    <tr><td>${i+1}</td><td>${e.name}</td><td>${e.login}</td>
      <td>${ROLES[e.role]?.label || e.role}</td>
      <td>${e.role!=='owner' ? `<button class="danger small" onclick="delEmployee(${e.id})">Удалить</button>` : '—'}</td></tr>`).join('');
  document.getElementById('rolesEmpty').style.display = db.employees.length ? 'none' : 'block';
  document.getElementById('dealersBody').innerHTML = db.dealers.map((d,i)=>`
    <tr><td>${i+1}</td><td>${d.name}</td><td>${d.login}</td>
      <td><button class="danger small" onclick="delDealer(${d.id})">Удалить</button></td></tr>`).join('');
  document.getElementById('dealersEmpty').style.display = db.dealers.length ? 'none' : 'block';
}
async function addEmployee(){
  const name = document.getElementById('r_name').value.trim();
  const login = document.getElementById('r_login').value.trim();
  const pass = document.getElementById('r_pass').value.trim();
  const role = document.getElementById('r_role').value;
  if(!name || !login || !pass){ showInfo('Ошибка', 'Заполни все поля'); return; }
  const res = await apiPost('/api/employees', { name, login, pass, role });
  if(res.error){ showInfo('Ошибка', res.error); return; }
  await audit('role_change', `${name} (${login})`);
  await loadDB(); renderRoles();
  ['r_name','r_login','r_pass'].forEach(id=>document.getElementById(id).value='');
}
async function delEmployee(id){ await apiDelete('/api/employees/'+id); await loadDB(); renderRoles(); }
async function addDealer(){
  const name = document.getElementById('d_name').value.trim();
  const login = document.getElementById('d_login').value.trim();
  const pass = document.getElementById('d_pass').value.trim();
  if(!name || !login || !pass){ showInfo('Ошибка', 'Заполни все поля'); return; }
  const res = await apiPost('/api/dealers', { name, login, pass });
  if(res.error){ showInfo('Ошибка', res.error); return; }
  await audit('dealer_add', `${name} (${login})`);
  await loadDB(); renderRoles();
  ['d_name','d_login','d_pass'].forEach(id=>document.getElementById(id).value='');
}
async function delDealer(id){ await apiDelete('/api/dealers/'+id); await loadDB(); renderRoles(); }

function renderAll(){
  if(hasPerm('dash')) renderDash();
  if(hasPerm('finance')) renderFinance();
  if(hasPerm('players')) renderPlayers();
  if(hasPerm('guests')) loadGuests();
  if(hasPerm('news')) renderNewsAdmin();
  if(hasPerm('reviews')) renderReviews();
  if(hasPerm('online')) renderOnline();
  if(hasPerm('payouts')) renderPayouts();
  if(hasPerm('history')) renderHistory();
  if(hasPerm('roles')) renderRoles();
  if(currentUser) document.getElementById('currentUser').textContent = currentUser;
  if(currentRole) document.getElementById('currentRole').textContent = ROLES[currentRole].label;
}

let liveCounter = 5;
async function tickLive(){
  liveCounter--;
  if(liveCounter <= 0){
    liveCounter = 5;
    if(currentUser){ await loadDB(); renderAll(); }
  }
}
setInterval(tickLive, 1000);

(async () => {
  const payDateEl = document.getElementById('pay_date');
  if (payDateEl) payDateEl.value = today();
})();
</script>
</body>
</html>
