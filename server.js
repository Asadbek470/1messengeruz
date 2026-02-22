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
const SECRET = "mySuperSecretKey"

const db = new Database("messenger.db")

// ---------------- DATABASE ----------------

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT
);
`)

// ---------------- REGISTER ----------------

app.post("/register", async (req, res) => {
  const { username, password } = req.body

  const hash = await bcrypt.hash(password, 10)

  try {
    db.prepare("INSERT INTO users (username,password) VALUES (?,?)")
      .run(username, hash)
    res.json({ ok: true })
  } catch {
    res.status(400).json({ error: "User already exists" })
  }
})

// ---------------- LOGIN ----------------

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

// ---------------- VERIFY ----------------

app.get("/verify", (req, res) => {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: "No token" })

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET)
    res.json({ user: decoded.username })
  } catch {
    res.status(401).json({ error: "Invalid token" })
  }
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
      if (onlineUsers[user] === ws) {
        delete onlineUsers[user]
      }
    }
  })
})

server.listen(PORT, () => {
  console.log("Running on port " + PORT)
})
