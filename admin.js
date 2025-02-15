require('dotenv').config()
const express = require('express')
const { Pool } = require('pg')
const http = require('http')
const { Server } = require('socket.io')

if (typeof fetch === 'undefined') {
	global.fetch = require('node-fetch')
}

const app = express()
const port = process.env.PORT || 4000

app.use(express.urlencoded({ extended: true }))
app.use(express.json())

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false },
})

pool
	.query(
		`
  ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP DEFAULT NOW()
`
	)
	.then(() => console.log('registered_at column ensured'))
	.catch(err => console.error('Error creating registered_at column:', err))

function isOnline(lastActivity) {
	if (!lastActivity) return false
	const now = new Date()
	const last = new Date(lastActivity)
	return (now - last) / (1000 * 60) <= 5
}

function badgeStatus(online) {
	return online
		? `<span style="background: linear-gradient(135deg, #4caf50, #2e7d32); padding: 0.3em 0.6em; border-radius: 0.25rem; color: #fff;">Online</span>`
		: `<span style="background: linear-gradient(135deg, #757575, #9e9e9e); padding: 0.3em 0.6em; border-radius: 0.25rem; color: #fff;">Offline</span>`
}

function buttonEditDelete(
	editUrl,
	deleteUrl,
	hiddenName,
	hiddenValue,
	confirmMsg
) {
	return `
    <div class="btn-group btn-group-sm">
      <a href="${editUrl}" class="btn" style="background: linear-gradient(135deg, #ffa726, #ffb74d); color:#fff;">Ред.</a>
      <form method="POST" action="${deleteUrl}" style="display:inline;" onsubmit="return confirm('${confirmMsg}');">
        <input type="hidden" name="${hiddenName}" value="${hiddenValue}">
        <button type="submit" class="btn" style="background: linear-gradient(135deg, #f44336, #e53935); color:#fff;">Уд.</button>
      </form>
    </div>
  `
}

function getHeader(
	title = 'Админ-панель',
	searchQuery = '',
	searchPlaceholder = 'Поиск...'
) {
	return `
<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/admin-lte@3.2/dist/css/adminlte.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/admin-lte@3.2/dist/css/dark-mode.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css" />
  <link rel="stylesheet" href="https://cdn.datatables.net/responsive/2.4.1/css/responsive.dataTables.min.css" />
  <link rel="stylesheet" href="https://cdn.datatables.net/buttons/2.3.6/css/buttons.dataTables.min.css">
  <style>
    body, html {
      font-family: 'Rubik', sans-serif;
    }
    body.dark-mode {
      background-color: #1f2937 !important;
    }
    html[data-theme='light'] body {
      background-color: #f8f9fa !important;
      color: #212529 !important;
    }
    .main-header.navbar-dark {
      background: #1f2937;
    }
    .brand-link {
      background: linear-gradient(135deg, #342b78, #8762d4) !important;
      color: #fff !important;
      text-align: center;
      font-weight: bold;
    }
    .sidebar-dark-primary {
      background: linear-gradient(135deg, #342b78, #8762d4);
    }
    .content-wrapper {
      min-height: 100vh;
    }
    .bg-lime {
      background-color: #b3e300 !important;
      color: #1f2937 !important;
    }
    .bg-pink {
      background-color: #d946ef !important;
      color: #fff !important;
    }
    .bg-teal {
      background-color: #14b8a6 !important;
      color: #fff !important;
    }
    .bg-indigo {
      background-color: #6366f1 !important;
      color: #fff !important;
    }
    #ordersChart {
      max-height: 280px !important;
    }
    .dt-button {
      background: #493c8b !important;
      color: #fff !important;
      border: none !important;
      margin-right: 0.3rem;
      border-radius: 0.25rem;
    }
    .dt-button:hover {
      background: #342b78 !important;
      color: #fff !important;
    }
    table.dataTable tbody td {
      white-space: nowrap;
    }
  </style>
</head>
<body class="hold-transition sidebar-mini dark-mode">
<div class="wrapper">
  <nav class="main-header navbar navbar-expand navbar-dark">
    <ul class="navbar-nav">
      <li class="nav-item">
        <a class="nav-link" data-widget="pushmenu" href="#"><i class="fas fa-bars"></i></a>
      </li>
      <li class="nav-item d-none d-sm-inline-block">
        <a href="/" class="nav-link">Дашборд</a>
      </li>
      <li class="nav-item d-none d-sm-inline-block">
        <a href="/clients" class="nav-link">Клиенты</a>
      </li>
      <li class="nav-item d-none d-sm-inline-block">
        <a href="/orders" class="nav-link">Заказы</a>
      </li>
    </ul>
    <ul class="navbar-nav ml-auto">
      <li class="nav-item">
        <a href="#" class="nav-link" id="themeToggle" title="Переключить тему">
          <i class="fas fa-adjust"></i>
        </a>
      </li>
      <li class="nav-item dropdown">
        <a class="nav-link" data-toggle="dropdown" href="#">
          <i class="far fa-bell"></i>
          <span class="badge badge-warning navbar-badge" id="notifCount">0</span>
        </a>
        <div class="dropdown-menu dropdown-menu-lg dropdown-menu-right">
          <span class="dropdown-header" id="notifHeader">Нет уведомлений</span>
          <div class="dropdown-divider"></div>
          <a href="#" class="dropdown-item dropdown-footer">Закрыть</a>
        </div>
      </li>
    </ul>
    <form class="form-inline ml-3" method="GET" action="">
      <div class="input-group input-group-sm">
        <input class="form-control form-control-navbar" name="search" type="search" value="${searchQuery}" placeholder="${searchPlaceholder}" aria-label="Search">
        <div class="input-group-append">
          <button class="btn btn-navbar" type="submit"><i class="fas fa-search"></i></button>
        </div>
      </div>
    </form>
  </nav>
  <aside class="main-sidebar sidebar-dark-primary elevation-4">
    <a href="/" class="brand-link">
      <span class="brand-text font-weight-light">Админ-панель</span>
    </a>
    <div class="sidebar">
      <div class="user-panel mt-3 pb-3 mb-3 d-flex">
        <div class="image">
          <img src="https://cdn-icons-png.flaticon.com/512/4333/4333609.png" class="img-circle elevation-2" alt="User">
        </div>
        <div class="info">
          <a href="#" class="d-block">Admin</a>
        </div>
      </div>
      <nav class="mt-2">
        <ul class="nav nav-pills nav-sidebar flex-column">
          <li class="nav-item">
            <a href="/" class="nav-link">
              <i class="nav-icon fas fa-home"></i>
              <p>Дашборд</p>
            </a>
          </li>
          <li class="nav-item">
            <a href="/clients" class="nav-link">
              <i class="nav-icon fas fa-users"></i>
              <p>Клиенты</p>
            </a>
          </li>
          <li class="nav-item">
            <a href="/orders" class="nav-link">
              <i class="nav-icon fas fa-shopping-cart"></i>
              <p>Заказы</p>
            </a>
          </li>
        </ul>
      </nav>
    </div>
  </aside>
  <div class="content-wrapper">
    <section class="content pt-3">
      <div class="container-fluid">
`
}

function getFooter() {
	return `
      </div>
    </section>
  </div>
  <footer class="main-footer">
    <strong>© ${new Date().getFullYear()} Админ-панель</strong>
  </footer>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/admin-lte@3.2/dist/js/adminlte.min.js"></script>
<script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.datatables.net/responsive/2.4.1/js/dataTables.responsive.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.3.6/js/dataTables.buttons.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.3.6/js/buttons.flash.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.3.6/js/buttons.html5.min.js"></script>
<script src="https://cdn.datatables.net/buttons/2.3.6/js/buttons.print.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@2.9.4/dist/Chart.min.js"></script>
<script>
  const dtRussian = {
    "decimal": "",
    "emptyTable": "Нет данных в таблице",
    "info": "Показаны записи с _START_ по _END_ (всего _TOTAL_)",
    "infoEmpty": "Нет записей",
    "infoFiltered": "(отфильтровано из _MAX_)",
    "infoPostFix": "",
    "thousands": ",",
    "lengthMenu": "Показать _MENU_ записей",
    "loadingRecords": "Загрузка...",
    "processing": "Обработка...",
    "search": "Поиск:",
    "zeroRecords": "Совпадений не найдено",
    "paginate": {
      "first": "Первая",
      "last": "Последняя",
      "next": "След.",
      "previous": "Пред."
    },
    "buttons": {
      "copy": "Копировать",
      "copyTitle": "Скопировано в буфер",
      "copySuccess": {
          "_": "Скопировано %d строк",
          "1": "Скопирована 1 строка"
      },
      "csv": "CSV",
      "excel": "Excel",
      "pdf": "PDF",
      "print": "Печать"
    }
  };
  $(document).ready(function(){
    $('.datatable').DataTable({
      responsive: true,
      language: dtRussian
    });
    $('.datatable-advanced').DataTable({
      responsive: true,
      language: dtRussian,
      dom: 'Bfrtip',
      buttons: ['copy','csv','excel','pdf','print']
    });
  });
</script>
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();
  let notifications = [];
  socket.on('notification', data => {
    notifications.push(data.message);
    $('#notifCount').text(notifications.length);
    $('#notifHeader').text('Уведомлений: ' + notifications.length);
    alert(data.message);
  });
</script>
<script>
  const htmlEl = document.documentElement;
  let currentTheme = 'dark';
  document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        currentTheme = (currentTheme === 'dark') ? 'light' : 'dark';
        htmlEl.setAttribute('data-theme', currentTheme);
        if (currentTheme === 'light') {
          document.body.classList.remove('dark-mode');
        } else {
          document.body.classList.add('dark-mode');
        }
        const ordersChartEl = document.getElementById('ordersChart');
        if (ordersChartEl) {
          const ctx = ordersChartEl.getContext('2d');
          if (Chart.instances[ordersChartEl.id]) {
            Chart.instances[ordersChartEl.id].destroy();
          }
          const borderColor = (currentTheme === 'light') ? '#7b61ff' : '#fff';
          // Перестроим график с новыми данными
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: ordersChartLabels,
              datasets: [{
                label: 'Заказы',
                data: ordersChartData,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderColor: borderColor,
                borderWidth: 2,
                fill: true
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false
            }
          });
        }
      });
    }
  });
</script>
</body>
</html>
`
}

// Создаем HTTP-сервер и Socket.io один раз
const server = http.createServer(app)
const ioServer = new Server(server)

// Дашборд
app.get('/', async (req, res) => {
	try {
		const search = req.query.search || ''
		const totalClientsRes = await pool.query('SELECT COUNT(*) FROM users')
		const totalOrdersRes = await pool.query('SELECT COUNT(*) FROM orders')
		const onlineRes = await pool.query(`
      SELECT COUNT(*) FROM users
      WHERE last_activity > CURRENT_TIMESTAMP - interval '5 minutes'
    `)
		const revenueRes = await pool.query(`
      SELECT COALESCE(SUM(totalamount),0) AS revenue
      FROM orders
      WHERE status='PAID'
    `)
		const totalClients = parseInt(totalClientsRes.rows[0].count)
		const totalOrders = parseInt(totalOrdersRes.rows[0].count)
		const onlineCount = parseInt(onlineRes.rows[0].count)
		const revenue = parseFloat(revenueRes.rows[0].revenue)

		// Формируем данные для графика заказов за последние 7 дней
		const ordersChartQuery = await pool.query(`
      SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as count
      FROM orders
      WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY day
      ORDER BY day;
    `)
		// Массив для 7 дней (индексы 0 - Пн, 6 - Вс)
		const ordersChartData = Array(7).fill(0)
		const ordersChartLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

		ordersChartQuery.rows.forEach(row => {
			const date = new Date(row.day)
			let jsDay = date.getDay() // 0 - Вс, 1 - Пн, ..., 6 - Сб
			let index = jsDay - 1
			if (jsDay === 0) index = 6 // Переносим воскресенье в конец
			ordersChartData[index] = parseInt(row.count)
		})

		// Формируем HTML для графика – теперь без встроенного скрипта, данные передадутся через глобальные переменные
		const chartHTML = `
      <canvas id="ordersChart"></canvas>
      <script>
        // Глобальные переменные для графика
        const ordersChartData = ${JSON.stringify(ordersChartData)};
        const ordersChartLabels = ${JSON.stringify(ordersChartLabels)};
        document.addEventListener('DOMContentLoaded', () => {
          const theme = document.documentElement.getAttribute('data-theme');
          const borderColor = (theme === 'light') ? '#7b61ff' : '#fff';
          const ctx = document.getElementById('ordersChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: ordersChartLabels,
              datasets: [{
                label: 'Заказы',
                data: ordersChartData,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderColor: borderColor,
                borderWidth: 2,
                fill: true
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false
            }
          });
        });
      </script>
    `

		const recentClients = (
			await pool.query(`
      SELECT * FROM users ORDER BY registered_at DESC LIMIT 5
    `)
		).rows
		let clientsHTML = ''
		recentClients.forEach(c => {
			clientsHTML += `
        <tr>
          <td>${c.chat_id}</td>
          <td>${c.name || ''}</td>
          <td>${c.phone || ''}</td>
          <td>${c.language || ''}</td>
          <td>${
						c.registered_at ? new Date(c.registered_at).toLocaleString() : ''
					}</td>
          <td>${badgeStatus(isOnline(c.last_activity))}</td>
        </tr>
      `
		})
		const recentOrders = (
			await pool.query(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT 5
    `)
		).rows
		let ordersHTML = ''
		recentOrders.forEach(o => {
			ordersHTML += `
        <tr>
          <td>${o.id}</td>
          <td>${o.merchant_trans_id || ''}</td>
          <td>${o.chat_id || ''}</td>
          <td>${o.totalamount || ''}</td>
          <td>${o.status || ''}</td>
          <td>${
						o.created_at ? new Date(o.created_at).toLocaleString() : ''
					}</td>
        </tr>
      `
		})
		const sidePanel = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fas fa-info-circle"></i> Информация о системе</h3>
          <div class="card-tools">
            <button class="btn btn-tool" id="refreshInfo"><i class="fas fa-sync-alt"></i></button>
          </div>
        </div>
        <div class="card-body" id="systemInfoBody">
          <p>Клиентов: <span id="infoClients">${totalClients}</span></p>
          <p>Заказов: <span id="infoOrders">${totalOrders}</span></p>
          <p>Онлайн: <span id="infoOnline">${onlineCount}</span></p>
          <p>Доход (PAID): <span id="infoRevenue">$${revenue.toFixed(
						2
					)}</span></p>
        </div>
      </div>
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          document.getElementById('refreshInfo').addEventListener('click', () => {
            fetch('/system-info')
              .then(res => res.json())
              .then(data => {
                document.getElementById('infoClients').textContent = data.totalClients;
                document.getElementById('infoOrders').textContent = data.totalOrders;
                document.getElementById('infoOnline').textContent = data.onlineCount;
                document.getElementById('infoRevenue').textContent = '$' + data.revenue.toFixed(2);
              })
              .catch(err => console.error('Ошибка /system-info:', err));
          });
        });
      </script>
    `
		const html = `
      ${getHeader('Дашборд', search)}
      <div class="row">
        <div class="col-lg-3 col-6">
          <div class="small-box bg-lime">
            <div class="inner">
              <h3>${totalClients}</h3>
              <p>Клиентов</p>
            </div>
            <div class="icon"><i class="fas fa-users"></i></div>
          </div>
        </div>
        <div class="col-lg-3 col-6">
          <div class="small-box bg-pink">
            <div class="inner">
              <h3>${totalOrders}</h3>
              <p>Заказы</p>
            </div>
            <div class="icon"><i class="fas fa-shopping-cart"></i></div>
          </div>
        </div>
        <div class="col-lg-3 col-6">
          <div class="small-box bg-teal">
            <div class="inner">
              <h3>${onlineCount}</h3>
              <p>Онлайн</p>
            </div>
            <div class="icon"><i class="fas fa-user-check"></i></div>
          </div>
        </div>
        <div class="col-lg-3 col-6">
          <div class="small-box bg-indigo">
            <div class="inner">
              <h3>$${revenue.toFixed(2)}</h3>
              <p>Доход (PAID)</p>
            </div>
            <div class="icon"><i class="fas fa-dollar-sign"></i></div>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fas fa-chart-line"></i> График заказов</h3>
            </div>
            <div class="card-body" style="height:280px;">
              ${chartHTML}
            </div>
          </div>
        </div>
        <div class="col-md-4">
          ${sidePanel}
        </div>
      </div>
      <div class="row">
        <div class="col-md-6">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fas fa-users"></i> Последние клиенты</h3>
            </div>
            <div class="card-body">
              <table class="table table-sm table-striped table-bordered table-hover datatable">
                <thead>
                  <tr>
                    <th>Chat ID</th>
                    <th>Имя</th>
                    <th>Телефон</th>
                    <th>Язык</th>
                    <th>Регистрация</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  ${clientsHTML}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fas fa-receipt"></i> Последние заказы</h3>
            </div>
            <div class="card-body">
              <table class="table table-sm table-striped table-bordered table-hover datatable">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Номер</th>
                    <th>Chat ID</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  ${ordersHTML}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке дашборда:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.get('/clients', async (req, res) => {
	try {
		const search = req.query.search || ''
		const result = await pool.query(
			'SELECT * FROM users ORDER BY registered_at DESC'
		)
		const clients = result.rows
		let rowsHTML = ''
		clients.forEach(c => {
			rowsHTML += `
        <tr>
          <td>${c.chat_id}</td>
          <td>${c.name || ''}</td>
          <td>${c.phone || ''}</td>
          <td>${c.language || ''}</td>
          <td>${
						c.registered_at ? new Date(c.registered_at).toLocaleString() : ''
					}</td>
          <td>${
						c.last_activity ? new Date(c.last_activity).toLocaleString() : ''
					}</td>
          <td>${badgeStatus(isOnline(c.last_activity))}</td>
          <td>
            ${buttonEditDelete(
							`/edit-client/${c.chat_id}`,
							'/delete-client',
							'chat_id',
							c.chat_id,
							'Удалить клиента?'
						)}
          </td>
        </tr>
      `
		})
		const addForm = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fas fa-user-plus"></i> Добавить клиента</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/add-client">
            <div class="form-group">
              <label>Chat ID</label>
              <input type="text" name="chat_id" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Имя</label>
              <input type="text" name="name" class="form-control">
            </div>
            <div class="form-group">
              <label>Телефон</label>
              <input type="text" name="phone" class="form-control">
            </div>
            <div class="form-group">
              <label>Язык</label>
              <input type="text" name="language" class="form-control">
            </div>
            <button type="submit" class="btn btn-primary">Добавить</button>
          </form>
        </div>
      </div>
    `
		const html = `
      ${getHeader('Клиенты', search)}
      <div class="row">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fas fa-users"></i> Список клиентов</h3>
            </div>
            <div class="card-body">
              <table class="table table-sm table-striped table-bordered table-hover datatable-advanced">
                <thead>
                  <tr>
                    <th>Chat ID</th>
                    <th>Имя</th>
                    <th>Телефон</th>
                    <th>Язык</th>
                    <th>Регистрация</th>
                    <th>Активность</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHTML}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          ${addForm}
        </div>
      </div>
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке клиентов:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/add-client', async (req, res) => {
	const { chat_id, name, phone, language } = req.body
	if (!chat_id) return res.status(400).send('Chat ID обязателен')
	try {
		await pool.query(
			`
      INSERT INTO users(chat_id, name, phone, language, registered_at, last_activity)
      VALUES($1, $2, $3, $4, NOW(), NOW())
    `,
			[chat_id, name, phone, language]
		)
		res.redirect('/clients')
	} catch (err) {
		console.error('Ошибка при добавлении клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.get('/edit-client/:chat_id', async (req, res) => {
	const { chat_id } = req.params
	try {
		const result = await pool.query('SELECT * FROM users WHERE chat_id=$1', [
			chat_id,
		])
		if (result.rowCount === 0) return res.status(404).send('Клиент не найден')
		const client = result.rows[0]
		const html = `
      ${getHeader('Редактировать клиента')}
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fas fa-user-edit"></i> Редактировать клиента</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/edit-client/${client.chat_id}">
            <div class="form-group">
              <label>Chat ID</label>
              <input type="text" class="form-control" value="${
								client.chat_id
							}" disabled>
            </div>
            <div class="form-group">
              <label>Имя</label>
              <input type="text" name="name" class="form-control" value="${
								client.name || ''
							}">
            </div>
            <div class="form-group">
              <label>Телефон</label>
              <input type="text" name="phone" class="form-control" value="${
								client.phone || ''
							}">
            </div>
            <div class="form-group">
              <label>Язык</label>
              <input type="text" name="language" class="form-control" value="${
								client.language || ''
							}">
            </div>
            <button type="submit" class="btn btn-primary">Сохранить</button>
            <a href="/clients" class="btn btn-secondary">Отмена</a>
          </form>
        </div>
      </div>
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/edit-client/:chat_id', async (req, res) => {
	const { chat_id } = req.params
	const { name, phone, language } = req.body
	try {
		await pool.query(
			`
      UPDATE users
      SET name=$1, phone=$2, language=$3
      WHERE chat_id=$4
    `,
			[name, phone, language, chat_id]
		)
		res.redirect('/clients')
	} catch (err) {
		console.error('Ошибка при обновлении клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/delete-client', async (req, res) => {
	const { chat_id } = req.body
	try {
		await pool.query('DELETE FROM users WHERE chat_id=$1', [chat_id])
		res.redirect(req.headers.referer || '/clients')
	} catch (err) {
		console.error('Ошибка при удалении клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.get('/orders', async (req, res) => {
	try {
		const search = req.query.search || ''
		const result = await pool.query(
			'SELECT * FROM orders ORDER BY created_at DESC'
		)
		const orders = result.rows
		let rowsHTML = ''
		orders.forEach(o => {
			rowsHTML += `
        <tr>
          <td>${o.id}</td>
          <td>${o.merchant_trans_id || ''}</td>
          <td>${o.chat_id || ''}</td>
          <td>${o.totalamount || ''}</td>
          <td>${o.status || ''}</td>
          <td>${
						o.created_at ? new Date(o.created_at).toLocaleString() : ''
					}</td>
          <td>
            ${buttonEditDelete(
							`/edit-order/${o.id}`,
							'/delete-order',
							'order_id',
							o.id,
							'Удалить заказ?'
						)}
          </td>
        </tr>
      `
		})
		const addForm = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fas fa-cart-plus"></i> Добавить заказ</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/add-order">
            <div class="form-group">
              <label>Номер заказа (merchant_trans_id)</label>
              <input type="text" name="merchant_trans_id" class="form-control">
            </div>
            <div class="form-group">
              <label>Chat ID</label>
              <input type="text" name="chat_id" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Сумма</label>
              <input type="number" step="0.01" name="totalamount" class="form-control" required>
            </div>
            <div class="form-group">
              <label>Статус</label>
              <select name="status" class="form-control">
                <option value="CREATED">CREATED</option>
                <option value="PAID">PAID</option>
                <option value="CANCELED">CANCELED</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary">Добавить</button>
          </form>
        </div>
      </div>
    `
		const html = `
      ${getHeader('Заказы', search)}
      <div class="row">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fas fa-shopping-cart"></i> Список заказов</h3>
            </div>
            <div class="card-body">
              <table class="table table-sm table-striped table-bordered table-hover datatable-advanced">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Номер</th>
                    <th>Chat ID</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата создания</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHTML}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          ${addForm}
        </div>
      </div>
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке заказов:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/add-order', async (req, res) => {
	const { merchant_trans_id, chat_id, totalamount, status } = req.body
	if (!chat_id) return res.status(400).send('Chat ID обязателен')
	try {
		await pool.query(
			`
      INSERT INTO orders(merchant_trans_id, chat_id, totalamount, status, created_at)
      VALUES($1, $2, $3, $4, NOW())
    `,
			[merchant_trans_id, chat_id, totalamount, status]
		)
		res.redirect('/orders')
	} catch (err) {
		console.error('Ошибка при добавлении заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.get('/edit-order/:order_id', async (req, res) => {
	const { order_id } = req.params
	try {
		const result = await pool.query('SELECT * FROM orders WHERE id=$1', [
			order_id,
		])
		if (result.rowCount === 0) return res.status(404).send('Заказ не найден')
		const order = result.rows[0]
		const html = `
      ${getHeader('Редактировать заказ')}
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fas fa-edit"></i> Редактировать заказ</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/edit-order/${order.id}">
            <div class="form-group">
              <label>Номер заказа (merchant_trans_id)</label>
              <input type="text" name="merchant_trans_id" class="form-control" value="${
								order.merchant_trans_id || ''
							}" required>
            </div>
            <div class="form-group">
              <label>Chat ID</label>
              <input type="text" name="chat_id" class="form-control" value="${
								order.chat_id || ''
							}" required>
            </div>
            <div class="form-group">
              <label>Сумма</label>
              <input type="number" step="0.01" name="totalamount" class="form-control" value="${
								order.totalamount || ''
							}" required>
            </div>
            <div class="form-group">
              <label>Статус</label>
              <select name="status" class="form-control">
                <option value="CREATED" ${
									order.status === 'CREATED' ? 'selected' : ''
								}>CREATED</option>
                <option value="PAID" ${
									order.status === 'PAID' ? 'selected' : ''
								}>PAID</option>
                <option value="CANCELED" ${
									order.status === 'CANCELED' ? 'selected' : ''
								}>CANCELED</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary">Сохранить</button>
            <a href="/orders" class="btn btn-secondary">Отмена</a>
          </form>
        </div>
      </div>
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/edit-order/:order_id', async (req, res) => {
	const { order_id } = req.params
	const { merchant_trans_id, chat_id, totalamount, status } = req.body
	try {
		await pool.query(
			`
      UPDATE orders
      SET merchant_trans_id=$1, chat_id=$2, totalamount=$3, status=$4
      WHERE id=$5
    `,
			[merchant_trans_id, chat_id, totalamount, status, order_id]
		)
		res.redirect('/orders')
	} catch (err) {
		console.error('Ошибка при обновлении заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.post('/delete-order', async (req, res) => {
	const { order_id } = req.body
	try {
		await pool.query('DELETE FROM orders WHERE id=$1', [order_id])
		res.redirect(req.headers.referer || '/orders')
	} catch (err) {
		console.error('Ошибка при удалении заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

app.get('/system-info', async (req, res) => {
	try {
		const totalClientsRes = await pool.query('SELECT COUNT(*) FROM users')
		const totalOrdersRes = await pool.query('SELECT COUNT(*) FROM orders')
		const onlineRes = await pool.query(`
      SELECT COUNT(*) FROM users
      WHERE last_activity > CURRENT_TIMESTAMP - interval '5 minutes'
    `)
		const revenueRes = await pool.query(`
      SELECT COALESCE(SUM(totalamount),0) AS revenue
      FROM orders
      WHERE status='PAID'
    `)
		res.json({
			totalClients: parseInt(totalClientsRes.rows[0].count),
			totalOrders: parseInt(totalOrdersRes.rows[0].count),
			onlineCount: parseInt(onlineRes.rows[0].count),
			revenue: parseFloat(revenueRes.rows[0].revenue),
		})
	} catch (err) {
		console.error('Ошибка /system-info:', err)
		res.status(500).json({ error: true })
	}
})

let lastUserCount = 0
let lastOrderCount = 0
async function pollDatabase() {
	try {
		const userRes = await pool.query('SELECT COUNT(*) FROM users')
		const orderRes = await pool.query('SELECT COUNT(*) FROM orders')
		const userCount = parseInt(userRes.rows[0].count)
		const orderCount = parseInt(orderRes.rows[0].count)
		if (lastUserCount && userCount > lastUserCount) {
			const diff = userCount - lastUserCount
			ioServer.emit('notification', {
				message: `Новый клиент зарегистрирован (+${diff})`,
			})
		}
		if (lastOrderCount && orderCount > lastOrderCount) {
			const diff = orderCount - lastOrderCount
			ioServer.emit('notification', {
				message: `Новый заказ создан (+${diff})`,
			})
		}
		lastUserCount = userCount
		lastOrderCount = orderCount
	} catch (err) {
		console.error('Ошибка при опросе БД:', err)
	}
}
setInterval(pollDatabase, 10000)

const selfPingUrl = process.env.SELF_PING_URL
if (selfPingUrl) {
	setInterval(() => {
		fetch(selfPingUrl)
			.then(r => console.log('Self-ping:', r.status))
			.catch(e => console.error('Self-ping err:', e))
	}, 240000)
}

server.listen(port, () => {
	console.log(`Админ-панель запущена на http://0.0.0.0:${port}`)
})
