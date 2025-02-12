/**************************************************
 * admin.js — Административное приложение (дашборд)
 * для мониторинга и управления клиентами и заказами
 *
 * Чувствительные данные вынесены в переменные окружения.
 * Для локальной разработки можно использовать файл .env.
 **************************************************/

// Для локальной разработки
require('dotenv').config()

const express = require('express')
const { Pool } = require('pg')
const http = require('http')
const { Server } = require('socket.io')

// Если используете Node.js ниже версии 18, убедитесь, что установлен пакет node-fetch
if (typeof fetch === 'undefined') {
	global.fetch = require('node-fetch')
}

const app = express()
// На Render переменная PORT задаётся автоматически. Для локальной разработки используется 4000, если PORT не определён.
const port = process.env.PORT || 4000

app.use(express.urlencoded({ extended: true }))

// Подключение к базе данных. Строка подключения должна быть в переменной окружения DATABASE_URL.
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl:
		process.env.NODE_ENV === 'production'
			? { rejectUnauthorized: false }
			: false,
})

const server = http.createServer(app)
const io = new Server(server)

// Функция определения онлайн‑статуса клиента (если last_activity ≤ 5 минут)
function isOnline(lastActivity) {
	const now = new Date()
	const last = new Date(lastActivity)
	const diffMinutes = (now - last) / (1000 * 60)
	return diffMinutes <= 5
}

// Функция формирования шапки страницы
function getHeader(title, searchQuery = '', searchPlaceholder = '') {
	return `
  <!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <!-- Bootstrap 4 -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    <!-- Font Awesome -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
      body { padding-top: 70px; }
      .navbar-brand { font-weight: bold; }
      /* Стили для уведомлений */
      #notification {
        position: fixed;
        top: 70px;
        right: 20px;
        z-index: 1050;
        min-width: 250px;
      }
    </style>
  </head>
  <body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
    <a class="navbar-brand" href="/">Админ-панель</a>
    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarsMenu"
      aria-controls="navbarsMenu" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarsMenu">
      <ul class="navbar-nav mr-auto">
        <li class="nav-item"><a class="nav-link" href="/">Дашборд</a></li>
        <li class="nav-item"><a class="nav-link" href="/clients">Клиенты</a></li>
        <li class="nav-item"><a class="nav-link" href="/orders">Заказы</a></li>
      </ul>
      <form class="form-inline my-2 my-lg-0" method="GET" action="">
        <input class="form-control mr-sm-2" name="search" value="${searchQuery}" type="search" placeholder="${searchPlaceholder}" aria-label="Search">
        <button class="btn btn-outline-light my-2 my-sm-0" type="submit">Поиск</button>
      </form>
    </div>
  </nav>
  <div class="container my-4">
    <!-- Контейнер для уведомлений -->
    <div id="notification"></div>
  `
}

// Функция формирования футера страницы
function getFooter() {
	return `
  </div>
  <!-- Audio для уведомлений -->
  <audio id="notificationSound" src="https://actions.google.com/sounds/v1/cartoon/pop.ogg" preload="auto"></audio>
  
  <!-- Скрипты: jQuery, Popper.js, Bootstrap, Chart.js и Socket.IO -->
  <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.1/dist/umd/popper.min.js"></script>
  <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    socket.on('notification', data => {
      // Воспроизводим звук уведомления
      const audio = document.getElementById('notificationSound');
      audio.play();
      
      // Добавляем уведомление
      const notifDiv = document.getElementById('notification');
      const notifElem = document.createElement('div');
      notifElem.className = 'alert alert-info alert-dismissible fade show';
      notifElem.role = 'alert';
      notifElem.innerHTML = data.message + 
        '<button type="button" class="close" data-dismiss="alert" aria-label="Close">' +
        '<span aria-hidden="true">&times;</span></button>';
      notifDiv.appendChild(notifElem);
      
      // Удаляем уведомление через 5 секунд
      setTimeout(() => {
        $(notifElem).alert('close');
      }, 5000);
    });
  </script>
  </body>
  </html>
  `
}

// ------------------------------
// Роуты приложения
// ------------------------------

// Главный маршрут — дашборд
app.get('/', async (req, res) => {
	try {
		const totalClientsResult = await pool.query('SELECT COUNT(*) FROM users')
		const totalOrdersResult = await pool.query('SELECT COUNT(*) FROM orders')
		const onlineClientsResult = await pool.query(
			"SELECT COUNT(*) FROM users WHERE last_activity > CURRENT_TIMESTAMP - interval '5 minutes'"
		)
		const pendingOrdersResult = await pool.query(
			"SELECT COUNT(*) FROM orders WHERE status = 'CREATED'"
		)
		const revenueResult = await pool.query(
			"SELECT COALESCE(SUM(totalamount),0) AS revenue FROM orders WHERE status = 'PAID'"
		)

		const totalClients = parseInt(totalClientsResult.rows[0].count)
		const totalOrders = parseInt(totalOrdersResult.rows[0].count)
		const onlineClients = parseInt(onlineClientsResult.rows[0].count)
		const pendingOrders = parseInt(pendingOrdersResult.rows[0].count)
		const revenue = parseFloat(revenueResult.rows[0].revenue)

		// Получаем последние 10 клиентов и заказов
		const recentClientsResult = await pool.query(
			'SELECT * FROM users ORDER BY last_activity DESC LIMIT 10'
		)
		const recentOrdersResult = await pool.query(
			'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10'
		)
		const recentClients = recentClientsResult.rows
		const recentOrders = recentOrdersResult.rows

		const metricsHTML = `
      <div class="row">
        <div class="col-md-2">
          <div class="card text-white bg-primary mb-3">
            <div class="card-body">
              <h5 class="card-title"><i class="fas fa-users"></i> Всего клиентов</h5>
              <p class="card-text">${totalClients}</p>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card text-white bg-info mb-3">
            <div class="card-body">
              <h5 class="card-title"><i class="fas fa-user-check"></i> Онлайн клиентов</h5>
              <p class="card-text">${onlineClients}</p>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card text-white bg-success mb-3">
            <div class="card-body">
              <h5 class="card-title"><i class="fas fa-shopping-cart"></i> Всего заказов</h5>
              <p class="card-text">${totalOrders}</p>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card text-white bg-warning mb-3">
            <div class="card-body">
              <h5 class="card-title"><i class="fas fa-hourglass-half"></i> Ожидающих заказов</h5>
              <p class="card-text">${pendingOrders}</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card text-white bg-dark mb-3">
            <div class="card-body">
              <h5 class="card-title"><i class="fas fa-dollar-sign"></i> Общий доход (PAID)</h5>
              <p class="card-text">$${revenue.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>
    `

		let clientsHTML = ''
		recentClients.forEach(client => {
			clientsHTML += `<tr>
        <td>${client.chat_id}</td>
        <td>${client.name || ''}</td>
        <td>${client.phone || ''}</td>
        <td>${client.language || ''}</td>
        <td>${
					client.last_activity
						? new Date(client.last_activity).toLocaleString()
						: ''
				}</td>
        <td>${
					isOnline(client.last_activity)
						? '<span class="badge badge-success">Online</span>'
						: '<span class="badge badge-secondary">Offline</span>'
				}</td>
        <td>
          <a href="/edit-client?chat_id=${
						client.chat_id
					}" class="btn btn-warning btn-sm">Редактировать</a>
          <form method="POST" action="/delete-client" onsubmit="return confirm('Удалить клиента?');" style="display:inline;">
            <input type="hidden" name="chat_id" value="${client.chat_id}">
            <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
          </form>
        </td>
      </tr>`
		})

		let ordersHTML = ''
		recentOrders.forEach(order => {
			ordersHTML += `<tr>
        <td>${order.id || ''}</td>
        <td>${order.merchant_trans_id || ''}</td>
        <td>${order.chat_id || ''}</td>
        <td>${order.totalamount || ''}</td>
        <td>${order.status || ''}</td>
        <td>${
					order.created_at ? new Date(order.created_at).toLocaleString() : ''
				}</td>
        <td>
          <a href="/edit-order?order_id=${
						order.id
					}" class="btn btn-warning btn-sm">Редактировать</a>
          <form method="POST" action="/delete-order" onsubmit="return confirm('Удалить заказ?');" style="display:inline;">
            <input type="hidden" name="order_id" value="${order.id}">
            <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
          </form>
        </td>
      </tr>`
		})

		const chartHTML = `
      <div class="card mb-4">
        <div class="card-header"><i class="fas fa-chart-line"></i> Динамика заказов за последние 7 дней</div>
        <div class="card-body">
          <canvas id="ordersChart" width="400" height="150"></canvas>
        </div>
      </div>
      <script>
        const ctx = document.getElementById('ordersChart').getContext('2d');
        const labels = [
          "${new Date(Date.now() - 6 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date(Date.now() - 5 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date(Date.now() - 4 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date(Date.now() - 3 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date(Date.now() - 2 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date(Date.now() - 1 * 24 * 3600 * 1000).toLocaleDateString()}",
          "${new Date().toLocaleDateString()}"
        ];
        const data = [5, 8, 3, 10, 7, 6, 9];
        const ordersChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Заказы',
              data: data,
              backgroundColor: 'rgba(54, 162, 235, 0.2)',
              borderColor: 'rgba(54, 162, 235, 1)',
              borderWidth: 2,
              fill: true,
            }]
          },
          options: {
            responsive: true,
            scales: {
              yAxes: [{
                ticks: { beginAtZero: true }
              }]
            }
          }
        });
      </script>
    `

		const html = `
      ${getHeader('Дашборд')}
      <h1>Дашборд</h1>
      ${metricsHTML}
      ${chartHTML}
      <h2>Последние клиенты</h2>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>Chat ID</th>
            <th>Имя</th>
            <th>Телефон</th>
            <th>Язык</th>
            <th>Последняя активность</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${clientsHTML}
        </tbody>
      </table>
      <h2>Последние заказы</h2>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>ID</th>
            <th>Номер заказа</th>
            <th>Chat ID</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th>Дата создания</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${ordersHTML}
        </tbody>
      </table>
      ${getFooter()}
    `

		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке дашборда:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Маршрут для списка клиентов
app.get('/clients', async (req, res) => {
	try {
		const search = req.query.search || ''
		let queryText = 'SELECT * FROM users'
		let queryParams = []
		if (search) {
			queryText += ' WHERE chat_id ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1'
			queryParams.push(`%${search}%`)
		}
		queryText += ' ORDER BY last_activity DESC'
		const clientsResult = await pool.query(queryText, queryParams)
		const clients = clientsResult.rows

		let clientsHTML = ''
		clients.forEach(client => {
			clientsHTML += `<tr>
        <td>${client.chat_id}</td>
        <td>${client.name || ''}</td>
        <td>${client.phone || ''}</td>
        <td>${client.language || ''}</td>
        <td>${
					client.last_activity
						? new Date(client.last_activity).toLocaleString()
						: ''
				}</td>
        <td>${
					isOnline(client.last_activity)
						? '<span class="badge badge-success">Online</span>'
						: '<span class="badge badge-secondary">Offline</span>'
				}</td>
        <td>
          <a href="/edit-client?chat_id=${
						client.chat_id
					}" class="btn btn-warning btn-sm">Редактировать</a>
          <form method="POST" action="/delete-client" onsubmit="return confirm('Удалить клиента?');" style="display:inline;">
            <input type="hidden" name="chat_id" value="${client.chat_id}">
            <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
          </form>
        </td>
      </tr>`
		})

		const html = `
      ${getHeader('Клиенты', search, 'Поиск по клиентам')}
      <h1>Клиенты</h1>
      <a href="/" class="btn btn-secondary mb-3">Назад на дашборд</a>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>Chat ID</th>
            <th>Имя</th>
            <th>Телефон</th>
            <th>Язык</th>
            <th>Последняя активность</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${clientsHTML}
        </tbody>
      </table>
      ${getFooter()}
    `

		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке клиентов:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Форма редактирования клиента
app.get('/edit-client', async (req, res) => {
	const chat_id = req.query.chat_id
	if (!chat_id) return res.status(400).send('chat_id не указан')
	try {
		const result = await pool.query('SELECT * FROM users WHERE chat_id = $1', [
			chat_id,
		])
		if (result.rowCount === 0) return res.status(404).send('Клиент не найден')
		const client = result.rows[0]
		const html = `
      ${getHeader('Редактировать клиента')}
      <h1>Редактировать клиента</h1>
      <form method="POST" action="/edit-client">
        <input type="hidden" name="chat_id" value="${client.chat_id}">
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
					}" required>
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
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке данных клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Обработка редактирования клиента
app.post('/edit-client', async (req, res) => {
	const { chat_id, name, phone, language } = req.body
	try {
		await pool.query(
			'UPDATE users SET name = $1, phone = $2, language = $3 WHERE chat_id = $4',
			[name, phone, language, chat_id]
		)
		res.redirect('/clients')
	} catch (err) {
		console.error('Ошибка при обновлении клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Список заказов
app.get('/orders', async (req, res) => {
	try {
		const search = req.query.search || ''
		let queryText = 'SELECT * FROM orders'
		let queryParams = []
		if (search) {
			queryText += ' WHERE merchant_trans_id ILIKE $1 OR chat_id ILIKE $1'
			queryParams.push(`%${search}%`)
		}
		queryText += ' ORDER BY created_at DESC'
		const ordersResult = await pool.query(queryText, queryParams)
		const orders = ordersResult.rows

		let ordersHTML = ''
		orders.forEach(order => {
			ordersHTML += `<tr>
        <td>${order.id || ''}</td>
        <td>${order.merchant_trans_id || ''}</td>
        <td>${order.chat_id || ''}</td>
        <td>${order.totalamount || ''}</td>
        <td>${order.status || ''}</td>
        <td>${
					order.created_at ? new Date(order.created_at).toLocaleString() : ''
				}</td>
        <td>
          <a href="/edit-order?order_id=${
						order.id
					}" class="btn btn-warning btn-sm">Редактировать</a>
          <form method="POST" action="/delete-order" onsubmit="return confirm('Удалить заказ?');" style="display:inline;">
            <input type="hidden" name="order_id" value="${order.id}">
            <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
          </form>
        </td>
      </tr>`
		})

		const html = `
      ${getHeader('Заказы', search, 'Поиск по заказам')}
      <h1>Заказы</h1>
      <a href="/" class="btn btn-secondary mb-3">Назад на дашборд</a>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>ID</th>
            <th>Номер заказа</th>
            <th>Chat ID</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th>Дата создания</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${ordersHTML}
        </tbody>
      </table>
      ${getFooter()}
    `

		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке заказов:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Форма редактирования заказа
app.get('/edit-order', async (req, res) => {
	const order_id = req.query.order_id
	if (!order_id) return res.status(400).send('order_id не указан')
	try {
		const result = await pool.query('SELECT * FROM orders WHERE id = $1', [
			order_id,
		])
		if (result.rowCount === 0) return res.status(404).send('Заказ не найден')
		const order = result.rows[0]
		const html = `
      ${getHeader('Редактировать заказ')}
      <h1>Редактировать заказ</h1>
      <form method="POST" action="/edit-order">
        <input type="hidden" name="order_id" value="${order.id}">
        <div class="form-group">
          <label>Номер заказа</label>
          <input type="text" class="form-control" value="${
						order.merchant_trans_id || ''
					}" disabled>
        </div>
        <div class="form-group">
          <label>Chat ID</label>
          <input type="text" class="form-control" value="${
						order.chat_id || ''
					}" disabled>
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
      ${getFooter()}
    `
		res.send(html)
	} catch (err) {
		console.error('Ошибка при загрузке данных заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Обработка редактирования заказа
app.post('/edit-order', async (req, res) => {
	const { order_id, totalamount, status } = req.body
	try {
		await pool.query(
			'UPDATE orders SET totalamount = $1, status = $2 WHERE id = $3',
			[totalamount, status, order_id]
		)
		res.redirect('/orders')
	} catch (err) {
		console.error('Ошибка при обновлении заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// API: Удаление клиента
app.post('/delete-client', async (req, res) => {
	const { chat_id } = req.body
	try {
		await pool.query('DELETE FROM users WHERE chat_id = $1', [chat_id])
		res.redirect(req.headers.referer || '/clients')
	} catch (err) {
		console.error('Ошибка при удалении клиента:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// API: Удаление заказа
app.post('/delete-order', async (req, res) => {
	const { order_id } = req.body
	try {
		await pool.query('DELETE FROM orders WHERE id = $1', [order_id])
		res.redirect(req.headers.referer || '/orders')
	} catch (err) {
		console.error('Ошибка при удалении заказа:', err)
		res.status(500).send('Ошибка сервера')
	}
})

// Ре‑тайм уведомления через Socket.IO (опрос базы каждые 10 секунд)
let lastUserCount = 0
let lastOrderCount = 0
async function pollDatabase() {
	try {
		const userResult = await pool.query('SELECT COUNT(*) FROM users')
		const orderResult = await pool.query('SELECT COUNT(*) FROM orders')
		const userCount = parseInt(userResult.rows[0].count)
		const orderCount = parseInt(orderResult.rows[0].count)

		if (lastUserCount && userCount > lastUserCount) {
			const diff = userCount - lastUserCount
			io.emit('notification', {
				message: `Новый клиент зарегистрирован (+${diff})`,
			})
		}
		if (lastOrderCount && orderCount > lastOrderCount) {
			const diff = orderCount - lastOrderCount
			io.emit('notification', {
				message: `Новый заказ поступил (+${diff})`,
			})
		}
		lastUserCount = userCount
		lastOrderCount = orderCount
	} catch (err) {
		console.error('Ошибка при опросе базы:', err)
	}
}
setInterval(pollDatabase, 10000)

// Автопинг для предотвращения "засыпания" инстанса (если задана переменная SELF_PING_URL)
const selfPingUrl = process.env.SELF_PING_URL
const pingInterval = process.env.PING_INTERVAL
	? parseInt(process.env.PING_INTERVAL)
	: 240000
if (selfPingUrl) {
	setInterval(() => {
		fetch(selfPingUrl)
			.then(response =>
				console.log(`Auto-ping выполнен, статус: ${response.status}`)
			)
			.catch(err => console.error('Ошибка автопинга:', err))
	}, pingInterval)
}

server.listen(port, () => {
	console.log(`Админ-панель запущена на http://localhost:${port}`)
})
