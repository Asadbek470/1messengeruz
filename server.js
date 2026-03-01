const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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

CREATE TABLE IF NOT EXISTS groups_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  ownerHandle TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupId INTEGER NOT NULL,
  userHandle TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
);
`);

function safeAlter(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    console.log("Migration skipped:", err.message);
  }
}

safeAlter(`ALTER TABLE users ADD COLUMN displayName TEXT`);
safeAlter(`ALTER TABLE users ADD COLUMN handle TEXT`);
safeAlter(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
safeAlter(`ALTER TABLE users ADD COLUMN blockedUntil INTEGER DEFAULT 0`);
safeAlter(`ALTER TABLE users ADD COLUMN strikes INTEGER DEFAULT 0`);

safeAlter(`ALTER TABLE messages ADD COLUMN chatType TEXT DEFAULT 'private'`);
safeAlter(`ALTER TABLE messages ADD COLUMN groupId INTEGER`);
safeAlter(`ALTER TABLE messages ADD COLUMN mediaType TEXT DEFAULT 'text'`);
safeAlter(`ALTER TABLE messages ADD COLUMN mediaUrl TEXT`);

safeAlter(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique ON users(handle)`);

db.prepare(`
  UPDATE users
  SET displayName = COALESCE(displayName, username)
`).run();

const usersWithoutHandle = db.prepare(`
  SELECT id, username FROM users WHERE handle IS NULL OR handle = ''
`).all();

for (const user of usersWithoutHandle) {
  const fallbackHandle = String(user.username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_") || `user_${user.id}`;

  db.prepare(`UPDATE users SET handle = ? WHERE id = ?`).run(fallbackHandle, user.id);
}

const bannedTerms = [
  "терракт",
  "теракт",
  "террор",
  "терроризм",
  "terror",
  "terrorism",
  "бомба",
  "взорву",
  "убью",
  "расстрел",
  "экстремизм",
  "extremism",
  "суицид",
  "самоубийство",
  "мессенджер тупой",
  "мессенджер глупый",
  "мессенджер наглый",
  "тупой мессенджер",
  "глупый мессенджер",
  "наглый мессенджер"
];

function normalizeHandle(value = "") {
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function getUserByHandle(handle) {
  return db.prepare(`
    SELECT id, username, password, displayName, handle, bio, blockedUntil, strikes
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

function isBlocked(user) {
  return Number(user.blockedUntil || 0) > Date.now();
}

function blockText(user) {
  const until = Number(user.blockedUntil || 0);
  const hours = Math.ceil((until - Date.now()) / (1000 * 60 * 60));
  return `Аккаунт временно заблокирован. Осталось примерно ${hours} ч.`;
}

function verify(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Нет токена" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(decoded.id);
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });

    if (isBlocked(user)) {
      return res.status(403).json({ error: blockText(user) });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Неверный токен" });
  }
}

function moderateMessage(userHandle, text) {
  const lowered = String(text || "").toLowerCase();
  const found = bannedTerms.find((term) => lowered.includes(term));

  if (!found) {
    return { ok: true };
  }

  const user = getUserByHandle(userHandle);
  const newStrikes = Number(user.strikes || 0) + 1;

  if (newStrikes >= 3) {
    const blockedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
    db.prepare(`
      UPDATE users
      SET strikes = 0, blockedUntil = ?
      WHERE handle = ?
    `).run(blockedUntil, userHandle);

    return {
      ok: false,
      blocked: true,
      message: `Вы нарушили правила 3 раза. Аккаунт заблокирован на 3 дня. Причина: "${found}".`
    };
  }

  db.prepare(`
    UPDATE users
    SET strikes = ?
    WHERE handle = ?
  `).run(newStrikes, userHandle);

  return {
    ok: false,
    blocked: false,
    message: `Сообщение отклонено из-за запрещённого слова/фразы: "${found}". Нарушение ${newStrikes}/3.`
  };
}

function areFriends(handle1, handle2) {
  return !!db.prepare(`
    SELECT 1 FROM friends WHERE user1 = ? AND user2 = ? LIMIT 1
  `).get(handle1, handle2);
}

function getGroup(groupId) {
  return db.prepare(`
    SELECT * FROM groups_table WHERE id = ?
  `).get(groupId);
}

function getGroupMember(groupId, handle) {
  return db.prepare(`
    SELECT * FROM group_members WHERE groupId = ? AND userHandle = ?
  `).get(groupId, handle);
}

function canManageGroup(groupId, handle) {
  const member = getGroupMember(groupId, handle);
  return member && (member.role === "owner" || member.role === "admin");
}

function sendJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function saveBase64Media(base64String, mediaType) {
  if (!base64String || typeof base64String !== "string") return null;

  const match = base64String.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1];
  const base64Data = match[2];

  let ext = "bin";

  if (mimeType.includes("jpeg")) ext = "jpg";
  else if (mimeType.includes("jpg")) ext = "jpg";
  else if (mimeType.includes("png")) ext = "png";
  else if (mimeType.includes("gif")) ext = "gif";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("mp4")) ext = "mp4";
  else if (mimeType.includes("webm")) ext = "webm";
  else if (mimeType.includes("ogg")) ext = "ogg";
  else if (mimeType.includes("mpeg")) ext = "mp3";

  const fileName = `${mediaType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

  return `/uploads/${fileName}`;
}

/* AUTH */

app.post("/register", async (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const handle = normalizeHandle(req.body.handle);
  const password = String(req.body.password || "").trim();

  if (!displayName || !handle || !password) {
    return res.status(400).json({ error: "Заполни все поля" });
  }

  if (!/^[a-z0-9_]{4,20}$/.test(handle)) {
    return res.status(400).json({ error: "Юзернейм: 4-20 символов, только буквы, цифры и _" });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: "Пароль слишком короткий" });
  }

  const exists = db.prepare(`SELECT id FROM users WHERE handle = ?`).get(handle);
  if (exists) {
    return res.status(400).json({ error: "Такой юзернейм уже занят" });
  }

  const hash = await bcrypt.hash(password, 10);

  const result = db.prepare(`
    INSERT INTO users (username, password, displayName, handle, bio, blockedUntil, strikes)
    VALUES (?, ?, ?, ?, '', 0, 0)
  `).run(displayName, hash, displayName, handle);

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);

  res.json({
    ok: true,
    token: makeToken(user)
  });
});

app.post("/login", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const password = String(req.body.password || "").trim();

  const user = getUserByIdentifier(identifier);
  if (!user) {
    return res.status(400).json({ error: "Пользователь не найден" });
  }

  if (isBlocked(user)) {
    return res.status(403).json({ error: blockText(user) });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(400).json({ error: "Неверный пароль" });
  }

  res.json({ token: makeToken(user) });
});

/* PROFILE */

app.get("/me", verify, (req, res) => {
  res.json({
    id: req.user.id,
    displayName: req.user.displayName,
    handle: req.user.handle,
    bio: req.user.bio || ""
  });
});

app.put("/me", verify, (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const handle = normalizeHandle(req.body.handle);
  const bio = String(req.body.bio || "").trim().slice(0, 300);

  if (!displayName || !handle) {
    return res.status(400).json({ error: "Имя и юзернейм обязательны" });
  }

  if (!/^[a-z0-9_]{4,20}$/.test(handle)) {
    return res.status(400).json({ error: "Некорректный юзернейм" });
  }

  const existing = db.prepare(`
    SELECT id FROM users WHERE handle = ? AND id != ?
  `).get(handle, req.user.id);

  if (existing) {
    return res.status(400).json({ error: "Этот юзернейм уже занят" });
  }

  db.prepare(`
    UPDATE users
    SET displayName = ?, handle = ?, bio = ?
    WHERE id = ?
  `).run(displayName, handle, bio, req.user.id);

  db.prepare(`UPDATE friends SET user1 = ? WHERE user1 = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE friends SET user2 = ? WHERE user2 = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE messages SET user1 = ? WHERE user1 = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE messages SET user2 = ? WHERE user2 = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE messages SET sender = ? WHERE sender = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE groups_table SET ownerHandle = ? WHERE ownerHandle = ?`).run(handle, req.user.handle);
  db.prepare(`UPDATE group_members SET userHandle = ? WHERE userHandle = ?`).run(handle, req.user.handle);

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);

  res.json({
    ok: true,
    message: "Профиль обновлён",
    token: makeToken(updated)
  });
});

/* USERS / FRIENDS */

app.get("/users/search", verify, (req, res) => {
  const q = normalizeHandle(req.query.q || "");
  if (!q) return res.json([]);

  const users = db.prepare(`
    SELECT displayName, handle, bio
    FROM users
    WHERE handle LIKE ?
      AND handle != ?
    ORDER BY handle ASC
    LIMIT 10
  `).all(`%${q}%`, req.user.handle);

  res.json(users);
});

app.post("/add-friend", verify, (req, res) => {
  const handle = normalizeHandle(req.body.handle);

  if (!handle) return res.status(400).json({ error: "Юзернейм обязателен" });
  if (handle === req.user.handle) return res.status(400).json({ error: "Нельзя добавить самого себя" });

  const friend = getUserByHandle(handle);
  if (!friend) return res.status(404).json({ error: "Пользователь не найден" });

  if (areFriends(req.user.handle, handle)) {
    return res.status(400).json({ error: "Уже в друзьях" });
  }

  db.prepare(`INSERT INTO friends (user1, user2) VALUES (?, ?)`).run(req.user.handle, handle);
  db.prepare(`INSERT INTO friends (user1, user2) VALUES (?, ?)`).run(handle, req.user.handle);

  res.json({ ok: true, message: "Друг добавлен" });
});

app.get("/friends", verify, (req, res) => {
  const friends = db.prepare(`
    SELECT u.displayName, u.handle, u.bio
    FROM friends f
    JOIN users u ON u.handle = f.user2
    WHERE f.user1 = ?
    ORDER BY u.displayName COLLATE NOCASE ASC
  `).all(req.user.handle);

  res.json(friends);
});

/* PRIVATE MESSAGES */

app.get("/messages/private/:handle", verify, (req, res) => {
  const friendHandle = normalizeHandle(req.params.handle);

  const messages = db.prepare(`
    SELECT
      m.id,
      m.sender AS senderHandle,
      u.displayName AS senderName,
      m.text,
      m.createdAt,
      m.mediaType,
      m.mediaUrl
    FROM messages m
    LEFT JOIN users u ON u.handle = m.sender
    WHERE m.chatType = 'private'
      AND (
        (m.user1 = ? AND m.user2 = ?)
        OR
        (m.user1 = ? AND m.user2 = ?)
      )
    ORDER BY m.createdAt ASC
  `).all(req.user.handle, friendHandle, friendHandle, req.user.handle);

  res.json(messages);
});

/* GROUPS */

app.post("/groups", verify, (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim().slice(0, 300);

  if (!name) {
    return res.status(400).json({ error: "Название группы обязательно" });
  }

  const result = db.prepare(`
    INSERT INTO groups_table (name, description, ownerHandle, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(name, description, req.user.handle, Date.now());

  db.prepare(`
    INSERT INTO group_members (groupId, userHandle, role)
    VALUES (?, ?, 'owner')
  `).run(result.lastInsertRowid, req.user.handle);

  res.json({ ok: true, message: "Группа создана", groupId: result.lastInsertRowid });
});

app.get("/groups", verify, (req, res) => {
  const groups = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.description,
      gm.role
    FROM group_members gm
    JOIN groups_table g ON g.id = gm.groupId
    WHERE gm.userHandle = ?
    ORDER BY g.createdAt DESC
  `).all(req.user.handle);

  res.json(groups);
});

app.get("/groups/:id", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const group = getGroup(groupId);
  const member = getGroupMember(groupId, req.user.handle);

  if (!group || !member) {
    return res.status(404).json({ error: "Группа не найдена" });
  }

  res.json({
    id: group.id,
    name: group.name,
    description: group.description,
    ownerHandle: group.ownerHandle,
    myRole: member.role
  });
});

app.put("/groups/:id", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim().slice(0, 300);

  if (!canManageGroup(groupId, req.user.handle)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  if (!name) {
    return res.status(400).json({ error: "Название группы обязательно" });
  }

  db.prepare(`
    UPDATE groups_table
    SET name = ?, description = ?
    WHERE id = ?
  `).run(name, description, groupId);

  res.json({ ok: true, message: "Группа обновлена" });
});

app.get("/groups/:id/members", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const member = getGroupMember(groupId, req.user.handle);

  if (!member) {
    return res.status(403).json({ error: "Вы не состоите в группе" });
  }

  const members = db.prepare(`
    SELECT gm.userHandle AS handle, gm.role, u.displayName
    FROM group_members gm
    JOIN users u ON u.handle = gm.userHandle
    WHERE gm.groupId = ?
    ORDER BY
      CASE gm.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        ELSE 3
      END,
      u.displayName COLLATE NOCASE ASC
  `).all(groupId);

  res.json(members);
});

app.post("/groups/:id/members", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const handle = normalizeHandle(req.body.handle);

  if (!canManageGroup(groupId, req.user.handle)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  const user = getUserByHandle(handle);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  const exists = getGroupMember(groupId, handle);
  if (exists) {
    return res.status(400).json({ error: "Участник уже в группе" });
  }

  db.prepare(`
    INSERT INTO group_members (groupId, userHandle, role)
    VALUES (?, ?, 'member')
  `).run(groupId, handle);

  res.json({ ok: true, message: "Участник добавлен" });
});

app.post("/groups/:id/role", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const handle = normalizeHandle(req.body.handle);
  const role = String(req.body.role || "").trim();

  if (!["member", "admin"].includes(role)) {
    return res.status(400).json({ error: "Некорректная роль" });
  }

  const myMember = getGroupMember(groupId, req.user.handle);
  const targetMember = getGroupMember(groupId, handle);

  if (!myMember || !targetMember) {
    return res.status(404).json({ error: "Участник не найден" });
  }

  if (!(myMember.role === "owner" || myMember.role === "admin")) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }

  if (targetMember.role === "owner") {
    return res.status(400).json({ error: "Нельзя изменить владельца" });
  }

  db.prepare(`
    UPDATE group_members
    SET role = ?
    WHERE groupId = ? AND userHandle = ?
  `).run(role, groupId, handle);

  res.json({ ok: true, message: "Роль изменена" });
});

app.get("/groups/:id/messages", verify, (req, res) => {
  const groupId = Number(req.params.id);
  const member = getGroupMember(groupId, req.user.handle);

  if (!member) {
    return res.status(403).json({ error: "Вы не состоите в группе" });
  }

  const messages = db.prepare(`
    SELECT
      m.id,
      m.sender AS senderHandle,
      u.displayName AS senderName,
      m.text,
      m.createdAt,
      m.groupId,
      m.mediaType,
      m.mediaUrl
    FROM messages m
    LEFT JOIN users u ON u.handle = m.sender
    WHERE m.chatType = 'group'
      AND m.groupId = ?
    ORDER BY m.createdAt ASC
  `).all(groupId);

  res.json(messages);
});

/* WEBSOCKET */

const onlineUsers = new Map();

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "join") {
        const decoded = jwt.verify(data.token, SECRET);
        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(decoded.id);
        if (!user || isBlocked(user)) return;

        ws.user = user;
        onlineUsers.set(user.handle, ws);
        return;
      }

      if (!ws.user) return;

      const freshUser = getUserByHandle(ws.user.handle);
      if (!freshUser || isBlocked(freshUser)) {
        sendJson(ws, { type: "moderation", message: freshUser ? blockText(freshUser) : "Доступ запрещён" });
        return;
      }

      if (data.type === "privateMessage") {
        const to = normalizeHandle(data.to);
        const text = String(data.text || "").trim();
        const mediaType = String(data.mediaType || "text");
        const mediaBase64 = data.mediaBase64 || null;

        if (!to) return;
        if (!areFriends(freshUser.handle, to)) {
          sendJson(ws, { type: "moderation", message: "Можно писать только друзьям" });
          return;
        }

        const isTextOnly = mediaType === "text";
        if (isTextOnly && !text) return;
        if (!isTextOnly && !mediaBase64) return;

        if (text) {
          const moderation = moderateMessage(freshUser.handle, text);
          if (!moderation.ok) {
            sendJson(ws, { type: "moderation", message: moderation.message });
            return;
          }
        }

        const createdAt = Date.now();
        let mediaUrl = null;

        if (!isTextOnly) {
          mediaUrl = saveBase64Media(mediaBase64, mediaType);
          if (!mediaUrl) {
            sendJson(ws, { type: "moderation", message: "Ошибка загрузки медиа" });
            return;
          }
        }

        db.prepare(`
          INSERT INTO messages (user1, user2, sender, text, createdAt, chatType, groupId, mediaType, mediaUrl)
          VALUES (?, ?, ?, ?, ?, 'private', NULL, ?, ?)
        `).run(
          freshUser.handle,
          to,
          freshUser.handle,
          text,
          createdAt,
          mediaType,
          mediaUrl
        );

        const payload = {
          type: "privateMessage",
          senderHandle: freshUser.handle,
          senderName: freshUser.displayName,
          to,
          text,
          createdAt,
          mediaType,
          mediaUrl
        };

        sendJson(ws, payload);
        sendJson(onlineUsers.get(to), payload);
      }

      if (data.type === "groupMessage") {
        const groupId = Number(data.groupId);
        const text = String(data.text || "").trim();
        const mediaType = String(data.mediaType || "text");
        const mediaBase64 = data.mediaBase64 || null;

        if (!groupId) return;

        const member = getGroupMember(groupId, freshUser.handle);
        if (!member) {
          sendJson(ws, { type: "moderation", message: "Вы не участник этой группы" });
          return;
        }

        const isTextOnly = mediaType === "text";
        if (isTextOnly && !text) return;
        if (!isTextOnly && !mediaBase64) return;

        if (text) {
          const moderation = moderateMessage(freshUser.handle, text);
          if (!moderation.ok) {
            sendJson(ws, { type: "moderation", message: moderation.message });
            return;
          }
        }

        const createdAt = Date.now();
        let mediaUrl = null;

        if (!isTextOnly) {
          mediaUrl = saveBase64Media(mediaBase64, mediaType);
          if (!mediaUrl) {
            sendJson(ws, { type: "moderation", message: "Ошибка загрузки медиа" });
            return;
          }
        }

        db.prepare(`
          INSERT INTO messages (user1, user2, sender, text, createdAt, chatType, groupId, mediaType, mediaUrl)
          VALUES (NULL, NULL, ?, ?, ?, 'group', ?, ?, ?)
        `).run(
          freshUser.handle,
          text,
          createdAt,
          groupId,
          mediaType,
          mediaUrl
        );

        const payload = {
          type: "groupMessage",
          groupId,
          senderHandle: freshUser.handle,
          senderName: freshUser.displayName,
          text,
          createdAt,
          mediaType,
          mediaUrl
        };

        const members = db.prepare(`
          SELECT userHandle FROM group_members WHERE groupId = ?
        `).all(groupId);

        members.forEach((m) => sendJson(onlineUsers.get(m.userHandle), payload));
      }
    } catch (err) {
      console.log("WS error:", err.message);
    }
  });

  ws.on("close", () => {
    if (ws.user?.handle) {
      onlineUsers.delete(ws.user.handle);
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
