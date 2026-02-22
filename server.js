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
const SECRET = "SuperSecretKey"

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

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user1 TEXT,
  user2 TEXT
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

  // добавить в друзья
  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(req.user, friend)

  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(friend, req.user)

  // создать приватный чат
  db.prepare("INSERT INTO chats (user1,user2) VALUES (?,?)")
    .run(req.user, friend)

  res.json({ ok: true })
})

app.get("/friends", verify, (req, res) => {
  const friends = db.prepare("SELECT user2 FROM friends WHERE user1=?")
    .all(req.user)
  res.json(friends)
})

// ---------------- LOAD MESSAGES ----------------

app.get("/chat/:friend", verify, (req, res) => {
  const friend = req.params.friend

  const chat = db.prepare(`
    SELECT * FROM chats
    WHERE (user1=? AND user2=?)
    OR (user1=? AND user2=?)
  `).get(req.user, friend, friend, req.user)

  if (!chat) return res.json([])

  const messages = db.prepare(
    "SELECT * FROM messages WHERE chatId=?"
  ).all(chat.id)

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

    if (data.type === "privateMessage") {

      const chat = db.prepare(`
        SELECT * FROM chats
        WHERE (user1=? AND user2=?)
        OR (user1=? AND user2=?)
      `).get(data.sender, data.to, data.to, data.sender)

      if (!chat) return

      db.prepare(`
        INSERT INTO messages (chatId,sender,text,createdAt)
        VALUES (?,?,?,?)
      `).run(chat.id, data.sender, data.text, Date.now())

      const targetSocket = onlineUsers[data.to]

      if (targetSocket) {
        targetSocket.send(JSON.stringify({
          type: "privateMessage",
          sender: data.sender,
          text: data.text
        }))
      }
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
  console.log("Messenger fixed and running")
})
