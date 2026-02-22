const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const Database = require("better-sqlite3")
const path = require("path")

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const PORT = process.env.PORT || 3000
const db = new Database("messenger.db")

// ---------------- DATABASE ----------------

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  type TEXT  -- private | group | channel
);

CREATE TABLE IF NOT EXISTS chat_members (
  chatId INTEGER,
  username TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId INTEGER,
  sender TEXT,
  text TEXT,
  createdAt INTEGER
);
`)

// ---------------- ONLINE USERS ----------------

let onlineUsers = {}

// ---------------- REST API ----------------

// создать пользователя
app.post("/register", (req, res) => {
  const { username } = req.body
  try {
    db.prepare("INSERT INTO users (username) VALUES (?)").run(username)
    res.json({ ok: true })
  } catch {
    res.status(400).json({ error: "User exists" })
  }
})

// создать чат
app.post("/create-chat", (req, res) => {
  const { name, type, members } = req.body

  const result = db.prepare(
    "INSERT INTO chats (name,type) VALUES (?,?)"
  ).run(name, type)

  const chatId = result.lastInsertRowid

  members.forEach(member => {
    db.prepare(
      "INSERT INTO chat_members (chatId,username) VALUES (?,?)"
    ).run(chatId, member)
  })

  res.json({ chatId })
})

// получить чаты пользователя
app.get("/user-chats/:username", (req, res) => {
  const username = req.params.username

  const chats = db.prepare(`
    SELECT chats.*
    FROM chats
    JOIN chat_members ON chats.id = chat_members.chatId
    WHERE chat_members.username = ?
  `).all(username)

  res.json(chats)
})

// ---------------- WEBSOCKET ----------------

wss.on("connection", ws => {

  ws.on("message", msg => {
    const data = JSON.parse(msg)

    // подключение
    if (data.type === "join") {
      onlineUsers[data.username] = ws
      return
    }

    // отправка сообщения
    if (data.type === "sendMessage") {

      db.prepare(`
        INSERT INTO messages (chatId,sender,text,createdAt)
        VALUES (?,?,?,?)
      `).run(data.chatId, data.sender, data.text, Date.now())

      const members = db.prepare(
        "SELECT username FROM chat_members WHERE chatId=?"
      ).all(data.chatId)

      members.forEach(member => {
        const userSocket = onlineUsers[member.username]
        if (userSocket) {
          userSocket.send(JSON.stringify({
            type: "newMessage",
            chatId: data.chatId,
            sender: data.sender,
            text: data.text
          }))
        }
      })
    }
  })

  ws.on("close", () => {
    for (let user in onlineUsers) {
      if (onlineUsers[user] === ws) {
        delete onlineUsers[user]
      }
    }
  })
})

server.listen(PORT, () => {
  console.log("Running on port " + PORT)
})
