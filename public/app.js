const token = localStorage.getItem("token");
const isChatPage = location.pathname.includes("chat");

const state = {
  user: null,
  ws: null,
  currentChat: null,
  currentGroup: null
};

function showToast(text, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) {
    alert(text);
    return;
  }
  toast.textContent = text;
  toast.style.color = isError ? "#dc4444" : "";
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.color = "";
  }, 2600);
}

function normalizeHandle(value = "") {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function decodeToken(jwtToken) {
  try {
    return JSON.parse(atob(jwtToken.split(".")[1]));
  } catch {
    return null;
  }
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

/* AUTH */

function switchAuth(mode) {
  const loginView = document.getElementById("loginView");
  const registerView = document.getElementById("registerView");
  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");

  if (!loginView || !registerView) return;

  const loginActive = mode === "login";

  loginView.classList.toggle("active", loginActive);
  registerView.classList.toggle("active", !loginActive);
  tabLogin.classList.toggle("active", loginActive);
  tabRegister.classList.toggle("active", !loginActive);
}

async function login() {
  const identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!identifier || !password) {
    showToast("Заполни логин и пароль", true);
    return;
  }

  try {
    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });

    localStorage.setItem("token", data.token);
    window.location.href = "chat.html";
  } catch (err) {
    showToast(err.message, true);
  }
}

async function register() {
  const displayName = document.getElementById("registerName").value.trim();
  const handle = normalizeHandle(document.getElementById("registerHandle").value);
  const password = document.getElementById("registerPassword").value.trim();

  if (!displayName || !handle || !password) {
    showToast("Заполни все поля", true);
    return;
  }

  try {
    const data = await api("/register", {
      method: "POST",
      body: JSON.stringify({ displayName, handle, password })
    });

    localStorage.setItem("token", data.token);
    window.location.href = "chat.html";
  } catch (err) {
    showToast(err.message, true);
  }
}

function bindAuthPage() {
  document.getElementById("tabLogin")?.addEventListener("click", () => switchAuth("login"));
  document.getElementById("tabRegister")?.addEventListener("click", () => switchAuth("register"));
  document.getElementById("goRegister")?.addEventListener("click", () => switchAuth("register"));
  document.getElementById("goLogin")?.addEventListener("click", () => switchAuth("login"));
  document.getElementById("loginBtn")?.addEventListener("click", login);
  document.getElementById("registerBtn")?.addEventListener("click", register);

  ["loginIdentifier", "loginPassword"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
  });

  ["registerName", "registerHandle", "registerPassword"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") register();
    });
  });
}

/* CHAT */

function logout() {
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

function openModal(id) {
  document.getElementById(id)?.classList.add("show");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("show");
}

function toggleSidebar(forceOpen) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (typeof forceOpen === "boolean") {
    sidebar.classList.toggle("open", forceOpen);
  } else {
    sidebar.classList.toggle("open");
  }
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMessage(msg) {
  const wrap = document.createElement("div");
  const mine = msg.senderHandle === state.user.handle;
  wrap.className = `message-row ${mine ? "mine" : "other"}`;

  wrap.innerHTML = `
    <div class="message-bubble">
      <div class="message-meta">${mine ? "Вы" : escapeHtml(msg.senderName || msg.senderHandle)} • ${formatTime(msg.createdAt)}</div>
      <div>${escapeHtml(msg.text || "")}</div>
    </div>
  `;

  return wrap;
}

function setChatHeader(title, subtitle) {
  document.getElementById("chatTitle").textContent = title;
  document.getElementById("chatSubtitle").textContent = subtitle;
}

function scrollMessagesDown() {
  const messages = document.getElementById("messages");
  messages.scrollTop = messages.scrollHeight;
}

async function loadProfile() {
  const me = await api("/me");
  state.user = me;

  document.getElementById("selfName").textContent = me.displayName;
  document.getElementById("selfHandle").textContent = "@" + me.handle;
  document.getElementById("selfBio").textContent = me.bio || "Без описания";

  document.getElementById("profileNameInput").value = me.displayName || "";
  document.getElementById("profileHandleInput").value = me.handle || "";
  document.getElementById("profileBioInput").value = me.bio || "";
}

async function saveProfile() {
  const displayName = document.getElementById("profileNameInput").value.trim();
  const handle = normalizeHandle(document.getElementById("profileHandleInput").value);
  const bio = document.getElementById("profileBioInput").value.trim();

  try {
    const data = await api("/me", {
      method: "PUT",
      body: JSON.stringify({ displayName, handle, bio })
    });

    showToast(data.message || "Профиль сохранён");
    closeModal("profileModal");
    await loadProfile();
    await loadFriends();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function searchUsers() {
  const q = normalizeHandle(document.getElementById("friendSearchInput").value);
  const results = document.getElementById("searchResults");
  results.innerHTML = "";

  if (!q) {
    showToast("Введи юзернейм", true);
    return;
  }

  try {
    const users = await api("/users/search?q=" + encodeURIComponent(q));

    if (!users.length) {
      results.innerHTML = `<div class="list-item">Никого не найдено</div>`;
      return;
    }

    users.forEach((user) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div class="list-title">${escapeHtml(user.displayName)}</div>
        <div class="list-subtitle">@${escapeHtml(user.handle)}</div>
        <div class="list-subtitle">${escapeHtml(user.bio || "Без описания")}</div>
        <div class="item-actions">
          <button class="primary-btn add-friend-btn" type="button" data-handle="${escapeHtml(user.handle)}">Добавить</button>
        </div>
      `;
      results.appendChild(item);
    });

    results.querySelectorAll(".add-friend-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const data = await api("/add-friend", {
            method: "POST",
            body: JSON.stringify({ handle: btn.dataset.handle })
          });
          showToast(data.message || "Друг добавлен");
          document.getElementById("friendSearchInput").value = "";
          results.innerHTML = "";
          await loadFriends();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadFriends() {
  const list = document.getElementById("friendsList");
  list.innerHTML = "";

  const friends = await api("/friends");

  if (!friends.length) {
    list.innerHTML = `<div class="list-item">Пока нет друзей</div>`;
    return;
  }

  friends.forEach((friend) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    item.innerHTML = `
      <div class="list-title">${escapeHtml(friend.displayName)}</div>
      <div class="list-subtitle">@${escapeHtml(friend.handle)}</div>
    `;
    item.addEventListener("click", () => openPrivateChat(friend));
    list.appendChild(item);
  });
}

async function loadGroups() {
  const list = document.getElementById("groupsList");
  list.innerHTML = "";

  const groups = await api("/groups");

  if (!groups.length) {
    list.innerHTML = `<div class="list-item">Пока нет групп</div>`;
    return;
  }

  groups.forEach((group) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    item.innerHTML = `
      <div class="list-title">${escapeHtml(group.name)}</div>
      <div class="list-subtitle">${escapeHtml(group.role)} • ${escapeHtml(group.description || "Без описания")}</div>
    `;
    item.addEventListener("click", () => openGroupChat(group));
    list.appendChild(item);
  });
}

async function openPrivateChat(friend) {
  state.currentChat = {
    type: "private",
    handle: friend.handle,
    title: friend.displayName,
    subtitle: "@" + friend.handle
  };
  state.currentGroup = null;

  document.getElementById("manageGroupBtn").classList.add("hidden");
  setChatHeader(friend.displayName, "@" + friend.handle);

  const messagesBox = document.getElementById("messages");
  messagesBox.innerHTML = "";

  const msgs = await api("/messages/private/" + encodeURIComponent(friend.handle));
  if (!msgs.length) {
    messagesBox.innerHTML = `<div class="empty-state">Начните диалог первым</div>`;
    return;
  }

  msgs.forEach((msg) => messagesBox.appendChild(renderMessage(msg)));
  scrollMessagesDown();
  toggleSidebar(false);
}

async function openGroupChat(group) {
  state.currentChat = {
    type: "group",
    id: group.id,
    title: group.name,
    subtitle: group.role
  };
  state.currentGroup = group;

  document.getElementById("manageGroupBtn").classList.remove("hidden");
  setChatHeader(group.name, group.description || group.role);

  const messagesBox = document.getElementById("messages");
  messagesBox.innerHTML = "";

  const msgs = await api("/groups/" + group.id + "/messages");
  if (!msgs.length) {
    messagesBox.innerHTML = `<div class="empty-state">В этой группе ещё нет сообщений</div>`;
    return;
  }

  msgs.forEach((msg) => messagesBox.appendChild(renderMessage(msg)));
  scrollMessagesDown();
  toggleSidebar(false);
}

function connectSocket() {
  state.ws = new WebSocket(
    location.protocol === "https:"
      ? "wss://" + location.host
      : "ws://" + location.host
  );

  state.ws.onopen = () => {
    state.ws.send(JSON.stringify({ type: "join", token }));
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "privateMessage") {
      if (state.currentChat?.type === "private" && state.currentChat.handle === data.senderHandle) {
        document.getElementById("messages").appendChild(renderMessage(data));
        scrollMessagesDown();
      }
      loadFriends();
    }

    if (data.type === "groupMessage") {
      if (state.currentChat?.type === "group" && Number(state.currentChat.id) === Number(data.groupId)) {
        document.getElementById("messages").appendChild(renderMessage(data));
        scrollMessagesDown();
      }
      loadGroups();
    }

    if (data.type === "moderation") {
      showToast(data.message, true);
    }
  };

  state.ws.onclose = () => {
    setTimeout(connectSocket, 1500);
  };
}

function sendMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();

  if (!state.currentChat) {
    showToast("Сначала выбери чат", true);
    return;
  }

  if (!text) return;

  if (state.currentChat.type === "private") {
    state.ws.send(JSON.stringify({
      type: "privateMessage",
      to: state.currentChat.handle,
      text
    }));
  }

  if (state.currentChat.type === "group") {
    state.ws.send(JSON.stringify({
      type: "groupMessage",
      groupId: state.currentChat.id,
      text
    }));
  }

  input.value = "";
}

async function createGroup() {
  const name = document.getElementById("newGroupName").value.trim();
  const description = document.getElementById("newGroupDescription").value.trim();

  if (!name) {
    showToast("Напиши название группы", true);
    return;
  }

  try {
    const data = await api("/groups", {
      method: "POST",
      body: JSON.stringify({ name, description })
    });

    showToast(data.message || "Группа создана");
    document.getElementById("newGroupName").value = "";
    document.getElementById("newGroupDescription").value = "";
    await loadGroups();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openGroupManager() {
  if (!state.currentGroup) return;

  try {
    const group = await api("/groups/" + state.currentGroup.id);
    const members = await api("/groups/" + state.currentGroup.id + "/members");

    document.getElementById("groupNameInput").value = group.name || "";
    document.getElementById("groupDescriptionInput").value = group.description || "";

    const membersList = document.getElementById("groupMembersList");
    membersList.innerHTML = "";

    members.forEach((member) => {
      const item = document.createElement("div");
      item.className = "list-item";

      let controls = "";
      if (group.myRole === "owner" || group.myRole === "admin") {
        if (member.role !== "owner") {
          controls += `
            <button class="ghost-btn role-btn" type="button" data-handle="${escapeHtml(member.handle)}" data-role="admin">Сделать админом</button>
            <button class="ghost-btn role-btn" type="button" data-handle="${escapeHtml(member.handle)}" data-role="member">Сделать участником</button>
          `;
        }
      }

      item.innerHTML = `
        <div class="list-title">${escapeHtml(member.displayName)} (@${escapeHtml(member.handle)})</div>
        <div class="list-subtitle">${escapeHtml(member.role)}</div>
        <div class="item-actions">${controls}</div>
      `;
      membersList.appendChild(item);
    });

    membersList.querySelectorAll(".role-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const data = await api("/groups/" + state.currentGroup.id + "/role", {
            method: "POST",
            body: JSON.stringify({
              handle: btn.dataset.handle,
              role: btn.dataset.role
            })
          });
          showToast(data.message || "Роль изменена");
          openGroupManager();
          loadGroups();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });

    openModal("groupModal");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function saveGroup() {
  if (!state.currentGroup) return;

  const name = document.getElementById("groupNameInput").value.trim();
  const description = document.getElementById("groupDescriptionInput").value.trim();

  try {
    const data = await api("/groups/" + state.currentGroup.id, {
      method: "PUT",
      body: JSON.stringify({ name, description })
    });
    showToast(data.message || "Группа обновлена");
    await loadGroups();
    state.currentGroup.name = name;
    state.currentGroup.description = description;
    setChatHeader(name, description || state.currentGroup.role);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addMemberToGroup() {
  if (!state.currentGroup) return;

  const handle = normalizeHandle(document.getElementById("groupMemberHandleInput").value);
  if (!handle) {
    showToast("Введи юзернейм", true);
    return;
  }

  try {
    const data = await api("/groups/" + state.currentGroup.id + "/members", {
      method: "POST",
      body: JSON.stringify({ handle })
    });
    showToast(data.message || "Участник добавлен");
    document.getElementById("groupMemberHandleInput").value = "";
    openGroupManager();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function initChatPage() {
  try {
    state.user = decodeToken(token);
    connectSocket();

    await loadProfile();
    await loadFriends();
    await loadGroups();

    document.getElementById("logoutBtn")?.addEventListener("click", logout);
    document.getElementById("friendSearchBtn")?.addEventListener("click", searchUsers);
    document.getElementById("createGroupBtn")?.addEventListener("click", createGroup);
    document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
    document.getElementById("messageInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    document.getElementById("openProfileBtn")?.addEventListener("click", () => openModal("profileModal"));
    document.getElementById("closeProfileBtn")?.addEventListener("click", () => closeModal("profileModal"));
    document.getElementById("saveProfileBtn")?.addEventListener("click", saveProfile);

    document.getElementById("manageGroupBtn")?.addEventListener("click", openGroupManager);
    document.getElementById("closeGroupBtn")?.addEventListener("click", () => closeModal("groupModal"));
    document.getElementById("saveGroupBtn")?.addEventListener("click", saveGroup);
    document.getElementById("addGroupMemberBtn")?.addEventListener("click", addMemberToGroup);

    document.getElementById("mobileOpenSidebar")?.addEventListener("click", () => toggleSidebar(true));
    document.getElementById("mobileCloseSidebar")?.addEventListener("click", () => toggleSidebar(false));
  } catch (err) {
    showToast(err.message, true);
    if (String(err.message).toLowerCase().includes("токен")) {
      logout();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (isChatPage) {
    if (!token) {
      window.location.href = "index.html";
      return;
    }
    initChatPage();
  } else {
    bindAuthPage();
  }
});
