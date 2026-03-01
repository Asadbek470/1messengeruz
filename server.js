const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const db = new Database('messenger.db');

// Инициализация БД
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    displayName TEXT,
    bio TEXT,
    strikes INTEGER DEFAULT 0
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Роут для отдачи HTML (защита от показа кода сервера)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket логика (базовая)
wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        // Тут будет логика обработки сообщений
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
