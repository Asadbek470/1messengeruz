const express = require("express")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const Database = require("better-sqlite3")
const WebSocket = require("ws")
const http = require("http")

const SECRET = "secretkey"
const app = express()
app.use(express.json())
app.use(express.static("public"))

const db = new Database("messenger.db")

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE,
 password TEXT,
 strikes INTEGER DEFAULT 0,
 bannedUntil INTEGER DEFAULT 0,
 permanentBan INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender TEXT,
 receiver TEXT,
 text TEXT,
 createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS groups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT
);
`)

const bannedWords = ["violence", "terror", "kill"]

function containsBad(text) {
 return bannedWords.some(w =>
   text.toLowerCase().includes(w)
 )
}

// Регистрация
app.post("/register", async (req,res)=>{
 const {username,password} = req.body
 const hash = await bcrypt.hash(password,10)
 try{
   db.prepare("INSERT INTO users (username,password) VALUES (?,?)")
     .run(username,hash)
   res.json({ok:true})
 }catch{
   res.status(400).json({error:"Username taken"})
 }
})

// Логин
app.post("/login", async (req,res)=>{
 const {username,password} = req.body
 const user = db.prepare("SELECT * FROM users WHERE username=?")
   .get(username)

 if(!user) return res.status(400).json({error:"Not found"})

 const valid = await bcrypt.compare(password,user.password)
 if(!valid) return res.status(400).json({error:"Wrong password"})

 const token = jwt.sign({username},SECRET)
 res.json({token})
})

// Поиск
app.get("/search/:username",(req,res)=>{
 const user = db.prepare("SELECT username FROM users WHERE username=?")
   .get(req.params.username)

 if(!user) return res.json({found:false})
 res.json({found:true,username:user.username})
})

const server = http.createServer(app)
const wss = new WebSocket.Server({server})

wss.on("connection", ws=>{
 ws.on("message", msg=>{
   const data = JSON.parse(msg)

   const user = db.prepare("SELECT * FROM users WHERE username=?")
     .get(data.sender)

   if(user.permanentBan) return
   if(Date.now() < user.bannedUntil) return

   if(containsBad(data.text)){
     let strikes = user.strikes + 1
     let bannedUntil = 0
     let permanent = 0

     if(strikes===1)
       bannedUntil = Date.now()+7*24*60*60*1000
     else if(strikes===2)
       bannedUntil = Date.now()+21*24*60*60*1000
     else
       permanent = 1

     db.prepare(`
       UPDATE users
       SET strikes=?,bannedUntil=?,permanentBan=?
       WHERE username=?
     `).run(strikes,bannedUntil,permanent,data.sender)

     ws.send(JSON.stringify({banned:true}))
     return
   }

   db.prepare(`
     INSERT INTO messages (sender,receiver,text,createdAt)
     VALUES (?,?,?,?)
   `).run(data.sender,data.receiver,data.text,Date.now())

   wss.clients.forEach(client=>{
     if(client.readyState===WebSocket.OPEN)
       client.send(JSON.stringify(data))
   })
 })
})

server.listen(3000)
