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

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user1 TEXT,
  user2 TEXT,
  sender TEXT,
  text TEXT,
  createdAt INTEGER
);
`)

// ---------- AUTH ----------

app.post("/register", async (req, res) => {
  const { username, password } = req.body
  if (!username || !password)
    return res.status(400).json({ error: "Fill fields" })

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

// ---------- FRIENDS ----------

app.post("/add-friend", verify, (req, res) => {
  const { friend } = req.body

  const exists = db.prepare("SELECT * FROM users WHERE username=?")
    .get(friend)

  if (!exists)
    return res.status(400).json({ error: "User not found" })

  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(req.user, friend)

  db.prepare("INSERT INTO friends VALUES (?,?)")
    .run(friend, req.user)

  res.json({ ok: true })
})

app.get("/friends", verify, (req, res) => {
  const friends = db.prepare("SELECT user2 FROM friends WHERE user1=?")
    .all(req.user)
  res.json(friends)
})

app.get("/messages/:friend", verify, (req, res) => {
  const friend = req.params.friend

  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE (user1=? AND user2=?)
    OR (user1=? AND user2=?)
    ORDER BY createdAt ASC
  `).all(req.user, friend, friend, req.user)

  res.json(messages)
})

// ---------- WEBSOCKET ----------

let onlineUsers = {}

wss.on("connection", ws => {

  ws.on("message", msg => {
    const data = JSON.parse(msg)

    if (data.type === "join") {
      onlineUsers[data.username] = ws
      return
    }

    if (data.type === "privateMessage") {

      db.prepare(`
        INSERT INTO messages (user1,user2,sender,text,createdAt)
        VALUES (?,?,?,?,?)
      `).run(
        data.sender,
        data.to,
        data.sender,
        data.text,
        Date.now()
      )

      const target = onlineUsers[data.to]
      if (target) {
        target.send(JSON.stringify({
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
  console.log("Server running")
})
