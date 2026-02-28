const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "SuperSecretKey";

const db = new Database("messenger.db");

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
`);

function safeAlter(sql) {
  try {
    db.exec(sql);
  } catch {}
}

safeAlter(`ALTER TABLE users ADD COLUMN displayName TEXT`);
safeAlter(`ALTER TABLE users ADD COLUMN handle TEXT UNIQUE`);
safeAlter(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
safeAlter(`ALTER TABLE users ADD COLUMN avatarColor TEXT DEFAULT '#5b7cff'`);

safeAlter(`ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'`);
safeAlter(`ALTER TABLE messages ADD COLUMN audioPath TEXT`);

safeAlter(`CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_pair ON friends(user1, user2)`);

db.prepare(`
  UPDATE users
  SET displayName = COALESCE(displayName, username)
`).run();

const usersWithoutHandle = db.prepare(`
  SELECT id, username FROM users WHERE handle IS NULL OR handle = ''
`).all();

for (const user of usersWithoutHandle) {
  db.prepare(`UPDATE users SET handle = ? WHERE id = ?`).run(
    String(user.username || "").toLowerCase(),
    user.id
  );
}

function normalizeHandle(value = "") {
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function randomAvatarColor() {
  const colors = [
    "#5b7cff",
    "#8b5cf6",
    "#06b6d4",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#ec4899"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName
    },
    SECRET,
    { expiresIn: "7d" }
  );
}

function verify(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    return res.status(401).json({ error: "Нет токена" });
  }

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Неверный токен" });
  }
}

function getUserByHandle(handle) {
  return db.prepare(`
    SELECT id, username, displayName, handle, bio, avatarColor
    FROM users
    WHERE handle = ?
  `).get(normalizeHandle(handle));
}

function getUserByIdentifier(identifier) {
  const value = normalizeHandle(identifier);

  return db.prepare(`
    SELECT *
    FROM users
    WHERE lower(handle) = ?
       OR lower(username) = ?
       OR lower(displayName) = ?
  `).get(value, value, value);
}

function areFriends(handle1, handle2) {
  const row = db.prepare(`
    SELECT 1 FROM friends WHERE user1 = ? AND user2 = ?
  `).get(handle1, handle2);

  return !!row;
}

/* ---------- AUTH ---------- */

app.post("/register", async (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const handle = normalizeHandle(req.body.handle);
  const password = String(req.body.password || "").trim();

  if (!displayName || !handle || !password) {
    return res.status(400).json({ error: "Заполни все поля" });
  }

  if (!/^[a-z0-9_]{4,20}$/.test(handle)) {
    return res.status(400).json({
      error: "Юзернейм должен быть от 4 до 20 символов: буквы, цифры, _"
    });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: "Пароль слишком короткий" });
  }

  const existing = db.prepare(`SELECT id FROM users WHERE handle = ?`).get(handle);
  if (existing) {
    return res.status(400).json({ error: "Такой юзернейм уже занят" });
  }

  const hash = await bcrypt.hash(password, 10);

  try {
    const result = db.prepare(`
      INSERT INTO users (username, displayName, handle, password, bio, avatarColor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(displayName, displayName, handle, hash, "", randomAvatarColor());

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);

    res.json({
      ok: true,
      message: "Аккаунт успешно создан",
      token: makeToken(user)
    });
  } catch (err) {
    res.status(400).json({ error: "Ошибка регистрации" });
  }
});

app.post("/login", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const password = String(req.body.password || "").trim();

  const user = getUserByIdentifier(identifier);

  if (!user) {
    return res.status(400).json({ error: "Пользователь не найден" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(400).json({ error: "Неверный пароль" });
  }

  res.json({ token: makeToken(user) });
});

/* ---------- PROFILE ---------- */

app.get("/me", verify, (req, res) => {
  const me = db.prepare(`
    SELECT id, displayName, handle, bio, avatarColor
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  res.json(me);
});

app.put("/me", verify, (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const bio = String(req.body.bio || "").trim().slice(0, 180);

  if (!displayName) {
    return res.status(400).json({ error: "Имя не должно быть пустым" });
  }

  db.prepare(`
    UPDATE users
    SET displayName = ?, bio = ?
    WHERE id = ?
  `).run(displayName, bio, req.user.id);

  res.json({ ok: true, message: "Профиль обновлён" });
});

/* ---------- SEARCH USERS ---------- */

app.get("/users/search", verify, (req, res) => {
  const q = normalizeHandle(req.query.q || "");
  if (!q) return res.json([]);

  const users = db.prepare(`
    SELECT displayName, handle, bio, avatarColor
    FROM users
    WHERE handle LIKE ?
      AND handle != ?
    ORDER BY handle ASC
    LIMIT 10
  `).all(`%${q}%`, req.user.handle);

  res.json(users);
});

/* ---------- FRIENDS ---------- */

app.post("/add-friend", verify, (req, res) => {
  const handle = normalizeHandle(req.body.handle);

  if (!handle) {
    return res.status(400).json({ error: "Юзернейм обязателен" });
  }

  if (handle === req.user.handle) {
    return res.status(400).json({ error: "Нельзя добавить самого себя" });
  }

  const exists = getUserByHandle(handle);

  if (!exists) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  if (areFriends(req.user.handle, handle)) {
    return res.status(400).json({ error: "Уже в друзьях" });
  }

  db.prepare(`INSERT OR IGNORE INTO friends (user1, user2) VALUES (?, ?)`)
    .run(req.user.handle, handle);

  db.prepare(`INSERT OR IGNORE INTO friends (user1, user2) VALUES (?, ?)`)
    .run(handle, req.user.handle);

  res.json({ ok: true, message: "Друг успешно добавлен" });
});

app.get("/friends", verify, (req, res) => {
  const friends = db.prepare(`
    SELECT
      f.user2 AS user2Handle,
      u.displayName,
      u.handle,
      u.bio,
      u.avatarColor
    FROM friends f
    JOIN users u ON u.handle = f.user2
    WHERE f.user1 = ?
    ORDER BY u.displayName COLLATE NOCASE ASC
  `).all(req.user.handle);

  res.json(friends);
});

/* ---------- MESSAGES ---------- */

app.get("/messages/:friend", verify, (req, res) => {
  const friendHandle = normalizeHandle(req.params.friend);

  if (!friendHandle) {
    return res.status(400).json({ error: "Неверный собеседник" });
  }

  const messages = db.prepare(`
    SELECT
      m.id,
      m.user1,
      m.user2,
      m.sender AS senderHandle,
      u.displayName AS senderName,
      m.text,
      m.type,
      m.audioPath,
      m.createdAt
    FROM messages m
    LEFT JOIN users u ON u.handle = m.sender
    WHERE (m.user1 = ? AND m.user2 = ?)
       OR (m.user1 = ? AND m.user2 = ?)
    ORDER BY m.createdAt ASC
  `).all(req.user.handle, friendHandle, friendHandle, req.user.handle);

  res.json(messages);
});

/* ---------- VOICE ---------- */

app.post("/upload-voice", verify, (req, res) => {
  const audio = String(req.body.audio || "");

  if (!audio.startsWith("data:audio/")) {
    return res.status(400).json({ error: "Некорректный аудиофайл" });
  }

  const match = audio.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: "Ошибка чтения аудио" });
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
    ? "mp4"
    : "webm";

  const fileName = `${req.user.handle}-${Date.now()}.${ext}`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

  res.json({
    ok: true,
    audioPath: `/uploads/${fileName}`
  });
});

/* ---------- WEBSOCKET ---------- */

const onlineUsers = new Map();

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "join") {
        const decoded = jwt.verify(data.token, SECRET);
        ws.user = decoded;
        onlineUsers.set(decoded.handle, ws);
        return;
      }

      if (data.type === "privateMessage") {
        if (!ws.user) return;

        const senderHandle = ws.user.handle;
        const to = normalizeHandle(data.to);
        const messageType = data.messageType === "audio" ? "audio" : "text";
        const text = messageType === "text" ? String(data.text || "").trim() : "";
        const audioPath = messageType === "audio" ? String(data.audioPath || "") : null;

        if (!to) return;
        if (messageType === "text" && !text) return;
        if (messageType === "audio" && !audioPath) return;

        const senderUser = getUserByHandle(senderHandle);
        const targetUser = getUserByHandle(to);

        if (!senderUser || !targetUser) return;
        if (!areFriends(senderHandle, to)) return;

        db.prepare(`
          INSERT INTO messages (user1, user2, sender, text, type, audioPath, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          senderHandle,
          to,
          senderHandle,
          text,
          messageType,
          audioPath,
          Date.now()
        );

        const payload = {
          type: "privateMessage",
          senderHandle,
          senderName: senderUser.displayName,
          messageType,
          text,
          audioPath,
          createdAt: Date.now()
        };

        const targetSocket = onlineUsers.get(to);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify(payload));
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    if (ws.user?.handle) {
      onlineUsers.delete(ws.user.handle);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
