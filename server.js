const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const Database = require("better-sqlite3")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const path = require("path")

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const PORT = process.env.PORT || 3000
const SECRET = "UltraSecretKey"

const db = new Database("messenger.db")

// ---------------- DATABASE ----------------

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT
);

CREATE TABLE IF NOT EXISTS friends (
  user1 TEXT,
  user2 TEXT
);

CREATE TABLE IF NOT EXISTS friend_requests (
  fromUser TEXT,
  toUser TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  type TEXT
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

// ---------------- AUTH ----------------

app.post("/register", async (req, res) => {
  const { username, password } = req.body
  const hash = await bcrypt.hash(password, 10)

  try {
    db.prepare("INSERT INTO users (username,password) VALUES (?,?)")
      .run(username, hash)
    res.json({ ok: true })
  } catch {
    res.status(400).json({ error: "User exists" })
  }
})

app.post("/login", async (req, res) => {
  const { username, password } = req.body

  const user = db.prepare("SELECT * FROM users WHERE username=?")
    .get(username)

  if (!user)
    return res.status(400).json({ error: "User not found" })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid)
    return res.status(400).json({ error: "Wrong password" })

  const token = jwt.sign({ username }, SECRET)
  res.json({ token })
})

function verify(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: "No token" })

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET)
    req.user = decoded.username
    next()
  } catch {
    res.status(401).json({ error: "Invalid token" })
  }
}

// ---------------- FRIEND SYSTEM ----------------

app.post("/add-friend", verify, (req, res) => {
  const { friend } = req.body
  db.prepare("INSERT INTO friend_requests VALUES (?,?)")
    .run(req.user, friend)
  res.json({ ok: true })
})

app.post("/accept-friend", verify, (req, res) => {
  const { fromUser } = req.body

  db.prepare("DELETE FROM friend_requests WHERE fromUser=? AND toUser=?")
    .run(fromUser, req.user)

  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(fromUser, req.user)

  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(req.user, fromUser)

  res.json({ ok: true })
})

app.get("/friends", verify, (req, res) => {
  const friends = db.prepare("SELECT user2 FROM friends WHERE user1=?")
    .all(req.user)
  res.json(friends)
})

// ---------------- CHAT CREATION ----------------

app.post("/create-chat", verify, (req, res) => {
  const { name, type, members } = req.body

  const result = db.prepare(
    "INSERT INTO chats (name,type) VALUES (?,?)"
  ).run(name, type)

  const chatId = result.lastInsertRowid

  members.forEach(member => {
    db.prepare("INSERT INTO chat_members VALUES (?,?)")
      .run(chatId, member)
  })

  res.json({ chatId })
})

app.get("/user-chats", verify, (req, res) => {
  const chats = db.prepare(`
    SELECT chats.*
    FROM chats
    JOIN chat_members ON chats.id = chat_members.chatId
    WHERE chat_members.username=?
  `).all(req.user)

  res.json(chats)
})

app.get("/chat-messages/:id", verify, (req, res) => {
  const messages = db.prepare(
    "SELECT * FROM messages WHERE chatId=?"
  ).all(req.params.id)

  res.json(messages)
})

// ---------------- WEBSOCKET ----------------

let onlineUsers = {}

wss.on("connection", ws => {

  ws.on("message", msg => {
    const data = JSON.parse(msg)

    if (data.type === "join") {
      onlineUsers[data.username] = ws
      return
    }

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
      if (onlineUsers[user] === ws)
        delete onlineUsers[user]
    }
  })
})

server.listen(PORT, () => {
  console.log("Messenger 3.0 running")
})
