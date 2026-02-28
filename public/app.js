const token = localStorage.getItem("token");

const isChatPage = location.pathname.includes("chat");
const isAuthPage = !isChatPage;

const state = {
  authUser: null,
  currentChat: null,
  ws: null,
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
  friends: []
};

function safeDecodeToken(jwtToken) {
  try {
    const payload = JSON.parse(atob(jwtToken.split(".")[1]));
    return payload;
  } catch {
    return null;
  }
}

if (isChatPage && !token) {
  window.location.href = "index.html";
}

if (token) {
  state.authUser = safeDecodeToken(token);
}

function normalizeHandle(value = "") {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) {
    if (isError) alert(message);
    return;
  }

  toast.textContent = message;
  toast.className = `toast show ${isError ? "error" : ""}`;

  setTimeout(() => {
    toast.className = "toast";
  }, 2500);
}

function logout() {
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(data.error || "Request error");
  }

  return data;
}

async function login() {
  const identifierInput = document.getElementById("loginIdentifier");
  const passwordInput = document.getElementById("loginPassword");

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value.trim();

  if (!identifier || !password) {
    showToast("Заполни логин и пароль", true);
    return;
  }

  try {
    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });

    if (data.token) {
      localStorage.setItem("token", data.token);
      window.location.href = "chat.html";
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function register() {
  const displayName = document.getElementById("registerName").value.trim();
  const handle = normalizeHandle(document.getElementById("registerHandle").value);
  const password = document.getElementById("registerPassword").value.trim();

  if (!displayName || !handle || !password) {
    showToast("Заполни все поля регистрации", true);
    return;
  }

  try {
    const data = await api("/register", {
      method: "POST",
      body: JSON.stringify({ displayName, handle, password })
    });

    showToast(data.message || "Аккаунт создан");
  } catch (err) {
    showToast(err.message, true);
  }
}

function connectSocket() {
  if (!state.authUser || !isChatPage) return;

  state.ws = new WebSocket(
    location.protocol === "https:"
      ? "wss://" + location.host
      : "ws://" + location.host
  );

  state.ws.onopen = () => {
    state.ws.send(
      JSON.stringify({
        type: "join",
        token
      })
    );
  };

  state.ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === "privateMessage") {
      const chatIsOpen =
        state.currentChat &&
        (
          data.senderHandle === state.currentChat.handle ||
          data.senderHandle === state.currentChat.user2Handle
        );

      if (chatIsOpen) {
        addMessageToUI({
          senderHandle: data.senderHandle,
          senderName: data.senderName,
          text: data.text || "",
          type: data.messageType || "text",
          audioPath: data.audioPath || null,
          createdAt: data.createdAt || Date.now()
        });
      }

      loadFriends();
    }

    if (data.type === "profileUpdated") {
      loadProfile();
      loadFriends();
    }
  };

  state.ws.onclose = () => {
    setTimeout(connectSocket, 1500);
  };
}

async function loadProfile() {
  try {
    const me = await api("/me");
    const profileName = document.getElementById("profileName");
    const profileHandle = document.getElementById("profileHandle");
    const profileBio = document.getElementById("profileBio");
    const selfBadge = document.getElementById("selfBadge");
    const selfMiniName = document.getElementById("selfMiniName");

    if (profileName) profileName.value = me.displayName || "";
    if (profileHandle) profileHandle.value = me.handle || "";
    if (profileBio) profileBio.value = me.bio || "";
    if (selfBadge) selfBadge.textContent = "@" + me.handle;
    if (selfMiniName) selfMiniName.textContent = me.displayName || me.handle;
  } catch (err) {
    showToast(err.message, true);
  }
}

async function saveProfile() {
  const displayName = document.getElementById("profileName").value.trim();
  const bio = document.getElementById("profileBio").value.trim();

  if (!displayName) {
    showToast("Имя профиля не должно быть пустым", true);
    return;
  }

  try {
    const data = await api("/me", {
      method: "PUT",
      body: JSON.stringify({ displayName, bio })
    });

    showToast(data.message || "Профиль обновлён");
    closeProfileModal();
    loadProfile();
    loadFriends();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadFriends() {
  try {
    const friends = await api("/friends");
    state.friends = friends;

    const friendsList = document.getElementById("friendsList");
    if (!friendsList) return;

    friendsList.innerHTML = "";

    if (!friends.length) {
      friendsList.innerHTML = `
        <div class="emptyState">
          Пока нет друзей.<br>
          Найди пользователя по юзернейму 👇
        </div>
      `;
      return;
    }

    friends.forEach((friend) => {
      const button = document.createElement("button");
      button.className = "friendItem";
      button.onclick = () => openChat(friend);

      button.innerHTML = `
        <div class="friendAvatar" style="background:${friend.avatarColor || "#4f46e5"}">
          ${(friend.displayName || friend.user2Handle || "?").charAt(0).toUpperCase()}
        </div>
        <div class="friendInfo">
          <div class="friendName">${escapeHtml(friend.displayName || friend.user2Handle)}</div>
          <div class="friendHandle">@${escapeHtml(friend.user2Handle)}</div>
        </div>
      `;

      friendsList.appendChild(button);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function searchUsers() {
  const searchInput = document.getElementById("userSearchInput");
  const query = normalizeHandle(searchInput.value);

  if (!query) {
    showToast("Введи юзернейм для поиска", true);
    return;
  }

  try {
    const users = await api("/users/search?q=" + encodeURIComponent(query));
    const results = document.getElementById("searchResults");
    results.innerHTML = "";

    if (!users.length) {
      results.innerHTML = `<div class="emptyState small">Никого не найдено</div>`;
      return;
    }

    users.forEach((user) => {
      const item = document.createElement("div");
      item.className = "searchUserCard";
      item.innerHTML = `
        <div class="friendAvatar" style="background:${user.avatarColor || "#4f46e5"}">
          ${(user.displayName || user.handle).charAt(0).toUpperCase()}
        </div>
        <div class="searchUserMeta">
          <div class="friendName">${escapeHtml(user.displayName)}</div>
          <div class="friendHandle">@${escapeHtml(user.handle)}</div>
          <div class="miniBio">${escapeHtml(user.bio || "Без описания")}</div>
        </div>
        <button class="primaryBtn smallBtn" data-handle="${user.handle}">
          Добавить
        </button>
      `;

      item.querySelector("button").onclick = () => addFriend(user.handle);
      results.appendChild(item);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addFriend(handle) {
  const cleanHandle = normalizeHandle(handle);

  try {
    const data = await api("/add-friend", {
      method: "POST",
      body: JSON.stringify({ handle: cleanHandle })
    });

    showToast(data.message || "Друг добавлен");
    loadFriends();
    document.getElementById("searchResults").innerHTML = "";
    document.getElementById("userSearchInput").value = "";
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openChat(friend) {
  state.currentChat = friend;

  const chatTitle = document.getElementById("chatTitle");
  const chatSubtitle = document.getElementById("chatSubtitle");
  const messages = document.getElementById("messages");

  if (chatTitle) chatTitle.textContent = friend.displayName || friend.user2Handle;
  if (chatSubtitle) chatSubtitle.textContent = "@" + friend.user2Handle;

  messages.innerHTML = `
    <div class="loadingState">Загрузка сообщений...</div>
  `;

  try {
    const msgs = await api("/messages/" + encodeURIComponent(friend.user2Handle));
    messages.innerHTML = "";
    msgs.forEach((msg) => addMessageToUI(msg));
    scrollMessagesToBottom();
  } catch (err) {
    showToast(err.message, true);
  }
}

function send() {
  const textInput = document.getElementById("text");
  const value = textInput.value.trim();

  if (!state.currentChat) {
    showToast("Сначала выбери чат", true);
    return;
  }

  if (!value) return;

  const message = {
    type: "privateMessage",
    to: state.currentChat.user2Handle,
    messageType: "text",
    text: value
  };

  state.ws.send(JSON.stringify(message));

  addMessageToUI({
    senderHandle: state.authUser.handle,
    senderName: state.authUser.displayName,
    text: value,
    type: "text",
    createdAt: Date.now()
  });

  textInput.value = "";
  scrollMessagesToBottom();
}

async function toggleRecording() {
  if (!state.currentChat) {
    showToast("Сначала открой чат", true);
    return;
  }

  const recordBtn = document.getElementById("recordBtn");

  if (state.isRecording && state.mediaRecorder) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    recordBtn.textContent = "🎙 Записать";
    recordBtn.classList.remove("dangerBtn");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.audioChunks, { type: "audio/webm" });
      const base64 = await blobToBase64(blob);

      try {
        const upload = await api("/upload-voice", {
          method: "POST",
          body: JSON.stringify({ audio: base64 })
        });

        state.ws.send(JSON.stringify({
          type: "privateMessage",
          to: state.currentChat.user2Handle,
          messageType: "audio",
          audioPath: upload.audioPath
        }));

        addMessageToUI({
          senderHandle: state.authUser.handle,
          senderName: state.authUser.displayName,
          type: "audio",
          audioPath: upload.audioPath,
          createdAt: Date.now()
        });

        scrollMessagesToBottom();
      } catch (err) {
        showToast(err.message, true);
      }

      stream.getTracks().forEach((track) => track.stop());
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    recordBtn.textContent = "⏹ Остановить";
    recordBtn.classList.add("dangerBtn");
  } catch {
    showToast("Не удалось получить доступ к микрофону", true);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addMessageToUI(message) {
  const messages = document.getElementById("messages");
  if (!messages) return;

  const mine = message.senderHandle === state.authUser.handle;

  const wrap = document.createElement("div");
  wrap.className = `messageRow ${mine ? "mine" : "theirs"}`;

  const bubble = document.createElement("div");
  bubble.className = `messageBubble ${message.type === "audio" ? "audioBubble" : ""}`;

  const meta = document.createElement("div");
  meta.className = "messageMeta";
  meta.textContent = `${mine ? "Вы" : (message.senderName || message.senderHandle)} • ${formatTime(message.createdAt)}`;

  bubble.appendChild(meta);

  if (message.type === "audio" && message.audioPath) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = message.audioPath;
    bubble.appendChild(audio);
  } else {
    const text = document.createElement("div");
    text.className = "messageText";
    text.textContent = message.text || "";
    bubble.appendChild(text);
  }

  wrap.appendChild(bubble);
  messages.appendChild(wrap);
}

function formatTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function scrollMessagesToBottom() {
  const messages = document.getElementById("messages");
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
}

function openProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.classList.add("show");
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.classList.remove("show");
}

function bindEnterSend() {
  const textInput = document.getElementById("text");
  if (!textInput) return;

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

function bindAuthEnter() {
  const fields = ["loginIdentifier", "loginPassword", "registerName", "registerHandle", "registerPassword"];
  fields.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (id.startsWith("login")) login();
        else register();
      }
    });
  });
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initChatPage() {
  if (!isChatPage || !state.authUser) return;

  connectSocket();
  loadProfile();
  loadFriends();
  bindEnterSend();

  const searchBtn = document.getElementById("searchUserBtn");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const recordBtn = document.getElementById("recordBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileBtn = document.getElementById("profileBtn");
  const closeProfileBtn = document.getElementById("closeProfileBtn");
  const sendBtn = document.getElementById("sendBtn");

  if (searchBtn) searchBtn.onclick = searchUsers;
  if (saveProfileBtn) saveProfileBtn.onclick = saveProfile;
  if (recordBtn) recordBtn.onclick = toggleRecording;
  if (logoutBtn) logoutBtn.onclick = logout;
  if (profileBtn) profileBtn.onclick = openProfileModal;
  if (closeProfileBtn) closeProfileBtn.onclick = closeProfileModal;
  if (sendBtn) sendBtn.onclick = send;
}

function initAuthPage() {
  if (!isAuthPage) return;
  bindAuthEnter();

  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");

  if (loginBtn) loginBtn.onclick = login;
  if (registerBtn) registerBtn.onclick = register;
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthPage();
  initChatPage();
});
