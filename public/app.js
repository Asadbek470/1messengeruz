const isChatPage = location.pathname.includes("chat");

const state = {
  currentChat: null,
  currentGroup: null,
  ws: null,
  me: null,
  token: localStorage.getItem("token")
};

function $(id) {
  return document.getElementById(id);
}

function showToast(text, isError = false) {
  const toast = $("toast");
  if (!toast) {
    alert(text);
    return;
  }

  toast.textContent = text;
  toast.style.color = isError ? "#e14b4b" : "";
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.color = "";
  }, 2600);
}

function normalizeHandle(value = "") {
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (state.token) {
    headers.Authorization = "Bearer " + state.token;
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

/* ---------- AUTH ---------- */

function switchAuth(mode) {
  $("loginView").classList.toggle("active", mode === "login");
  $("registerView").classList.toggle("active", mode === "register");
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
}

async function login() {
  try {
    const identifier = $("loginIdentifier").value.trim();
    const password = $("loginPassword").value.trim();

    if (!identifier || !password) {
      showToast("Заполни логин и пароль", true);
      return;
    }

    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });

    state.token = data.token;
    localStorage.setItem("token", data.token);
    window.location.href = "chat.html";
  } catch (err) {
    showToast(err.message, true);
  }
}

async function register() {
  try {
    const displayName = $("registerName").value.trim();
    const handle = normalizeHandle($("registerHandle").value);
    const password = $("registerPassword").value.trim();

    if (!displayName || !handle || !password) {
      showToast("Заполни все поля", true);
      return;
    }

    const data = await api("/register", {
      method: "POST",
      body: JSON.stringify({ displayName, handle, password })
    });

    state.token = data.token;
    localStorage.setItem("token", data.token);
    window.location.href = "chat.html";
  } catch (err) {
    showToast(err.message, true);
  }
}

function initAuthPage() {
  $("tabLogin")?.addEventListener("click", () => switchAuth("login"));
  $("tabRegister")?.addEventListener("click", () => switchAuth("register"));
  $("showRegisterLink")?.addEventListener("click", () => switchAuth("register"));
  $("showLoginLink")?.addEventListener("click", () => switchAuth("login"));
  $("loginBtn")?.addEventListener("click", login);
  $("registerBtn")?.addEventListener("click", register);

  ["loginIdentifier", "loginPassword"].forEach((id) => {
    $(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
  });

  ["registerName", "registerHandle", "registerPassword"].forEach((id) => {
    $(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") register();
    });
  });
}

/* ---------- CHAT ---------- */

function logout() {
  localStorage.removeItem("token");
  state.token = null;
  window.location.href = "index.html";
}

function openModal(id) {
  $(id)?.classList.remove("hidden");
}

function closeModal(id) {
  $(id)?.classList.add("hidden");
}

function toggleSidebar(force) {
  const sidebar = $("sidebar");
  if (!sidebar) return;

  if (typeof force === "boolean") {
    sidebar.classList.toggle("open", force);
  } else {
    sidebar.classList.toggle("open");
  }
}

function setChatHeader(title, subtitle) {
  $("chatTitle").textContent = title;
  $("chatSubtitle").textContent = subtitle;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
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
  const myHandle = state.me?.handle;
  const mine = msg.senderHandle === myHandle;

  const row = document.createElement("div");
  row.className = `message-row ${mine ? "mine" : "other"}`;

  row.innerHTML = `
    <div class="message-bubble">
      <div class="message-meta">
        ${mine ? "Вы" : escapeHtml(msg.senderName || msg.senderHandle)} • ${formatTime(msg.createdAt)}
      </div>
      <div>${escapeHtml(msg.text || "")}</div>
    </div>
  `;

  return row;
}

function scrollMessages() {
  const box = $("messages");
  if (box) box.scrollTop = box.scrollHeight;
}

async function loadProfile() {
  const me = await api("/me");
  state.me = me;

  $("selfName").textContent = me.displayName || "Пользователь";
  $("selfHandle").textContent = "@" + (me.handle || "username");
  $("selfBio").textContent = me.bio || "Без описания";

  $("profileNameInput").value = me.displayName || "";
  $("profileHandleInput").value = me.handle || "";
  $("profileBioInput").value = me.bio || "";
}

async function saveProfile() {
  try {
    const displayName = $("profileNameInput").value.trim();
    const handle = normalizeHandle($("profileHandleInput").value);
    const bio = $("profileBioInput").value.trim();

    const data = await api("/me", {
      method: "PUT",
      body: JSON.stringify({ displayName, handle, bio })
    });

    if (data.token) {
      state.token = data.token;
      localStorage.setItem("token", data.token);
    }

    showToast(data.message || "Профиль сохранён");
    closeModal("profileModal");
    await loadProfile();
    await loadFriends();

    if (state.ws) {
      try {
        state.ws.close();
      } catch {}
      connectSocket();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function searchUsers() {
  try {
    const q = normalizeHandle($("friendSearchInput").value);
    const results = $("searchResults");
    results.innerHTML = "";

    if (!q) {
      showToast("Введи юзернейм", true);
      return;
    }

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
          <button class="primary-btn add-friend-btn" data-handle="${escapeHtml(user.handle)}" type="button">Добавить</button>
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
          $("friendSearchInput").value = "";
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
  const list = $("friendsList");
  list.innerHTML = "";

  const friends = await api("/friends");

  if (!friends.length) {
    list.innerHTML = `<div class="list-item">Пока нет друзей</div>`;
    return;
  }

  friends.forEach((friend) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-item-button";
    btn.innerHTML = `
      <div class="list-title">${escapeHtml(friend.displayName)}</div>
      <div class="list-subtitle">@${escapeHtml(friend.handle)}</div>
    `;
    btn.addEventListener("click", () => openPrivateChat(friend));
    list.appendChild(btn);
  });
}

async function loadGroups() {
  const list = $("groupsList");
  list.innerHTML = "";

  const groups = await api("/groups");

  if (!groups.length) {
    list.innerHTML = `<div class="list-item">Пока нет групп</div>`;
    return;
  }

  groups.forEach((group) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-item-button";
    btn.innerHTML = `
      <div class="list-title">${escapeHtml(group.name)}</div>
      <div class="list-subtitle">${escapeHtml(group.role || "")}</div>
      <div class="list-subtitle">${escapeHtml(group.description || "Без описания")}</div>
    `;
    btn.addEventListener("click", () => openGroupChat(group));
    list.appendChild(btn);
  });
}

async function openPrivateChat(friend) {
  state.currentChat = {
    type: "private",
    handle: friend.handle
  };
  state.currentGroup = null;

  $("manageGroupBtn").classList.add("hidden");
  setChatHeader(friend.displayName, "@" + friend.handle);

  const msgs = await api("/messages/private/" + encodeURIComponent(friend.handle));
  const box = $("messages");
  box.innerHTML = "";

  if (!msgs.length) {
    box.innerHTML = `<div class="empty-state">Начните диалог первым</div>`;
    toggleSidebar(false);
    return;
  }

  msgs.forEach((msg) => box.appendChild(renderMessage(msg)));
  scrollMessages();
  toggleSidebar(false);
}

async function openGroupChat(group) {
  state.currentChat = {
    type: "group",
    id: group.id
  };
  state.currentGroup = group;

  $("manageGroupBtn").classList.remove("hidden");
  setChatHeader(group.name, group.description || group.role || "Группа");

  const msgs = await api("/groups/" + group.id + "/messages");
  const box = $("messages");
  box.innerHTML = "";

  if (!msgs.length) {
    box.innerHTML = `<div class="empty-state">В этой группе пока нет сообщений</div>`;
    toggleSidebar(false);
    return;
  }

  msgs.forEach((msg) => box.appendChild(renderMessage(msg)));
  scrollMessages();
  toggleSidebar(false);
}

function connectSocket() {
  if (!state.token) return;

  state.ws = new WebSocket(
    location.protocol === "https:"
      ? "wss://" + location.host
      : "ws://" + location.host
  );

  state.ws.onopen = () => {
    state.ws.send(JSON.stringify({ type: "join", token: state.token }));
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "privateMessage") {
      if (
        state.currentChat?.type === "private" &&
        data.senderHandle === state.currentChat.handle
      ) {
        $("messages").appendChild(renderMessage(data));
        scrollMessages();
      }
      loadFriends();
    }

    if (data.type === "groupMessage") {
      if (
        state.currentChat?.type === "group" &&
        Number(state.currentChat.id) === Number(data.groupId)
      ) {
        $("messages").appendChild(renderMessage(data));
        scrollMessages();
      }
      loadGroups();
    }

    if (data.type === "moderation") {
      showToast(data.message, true);
    }
  };

  state.ws.onclose = () => {
    setTimeout(() => {
      if (state.token) connectSocket();
    }, 1500);
  };
}

function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();

  if (!state.currentChat) {
    showToast("Сначала выбери чат", true);
    return;
  }

  if (!text) return;

  if (state.currentChat.type === "private") {
    state.ws.send(
      JSON.stringify({
        type: "privateMessage",
        to: state.currentChat.handle,
        text
      })
    );

    $("messages").appendChild(
      renderMessage({
        senderHandle: state.me.handle,
        senderName: state.me.displayName,
        text,
        createdAt: Date.now()
      })
    );
  }

  if (state.currentChat.type === "group") {
    state.ws.send(
      JSON.stringify({
        type: "groupMessage",
        groupId: state.currentChat.id,
        text
      })
    );
  }

  input.value = "";
  scrollMessages();
}

async function createGroup() {
  try {
    const name = $("newGroupName").value.trim();
    const description = $("newGroupDescription").value.trim();

    if (!name) {
      showToast("Напиши название группы", true);
      return;
    }

    const data = await api("/groups", {
      method: "POST",
      body: JSON.stringify({ name, description })
    });

    showToast(data.message || "Группа создана");
    $("newGroupName").value = "";
    $("newGroupDescription").value = "";
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

    $("groupNameInput").value = group.name || "";
    $("groupDescriptionInput").value = group.description || "";

    const membersList = $("groupMembersList");
    membersList.innerHTML = "";

    members.forEach((member) => {
      const item = document.createElement("div");
      item.className = "list-item";

      let controls = "";
      if ((group.myRole === "owner" || group.myRole === "admin") && member.role !== "owner") {
        controls = `
          <div class="item-actions">
            <button class="ghost-btn role-btn" data-handle="${escapeHtml(member.handle)}" data-role="admin" type="button">Сделать админом</button>
            <button class="ghost-btn role-btn" data-handle="${escapeHtml(member.handle)}" data-role="member" type="button">Сделать участником</button>
          </div>
        `;
      }

      item.innerHTML = `
        <div class="list-title">${escapeHtml(member.displayName)} (@${escapeHtml(member.handle)})</div>
        <div class="list-subtitle">${escapeHtml(member.role)}</div>
        ${controls}
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

  try {
    const name = $("groupNameInput").value.trim();
    const description = $("groupDescriptionInput").value.trim();

    const data = await api("/groups/" + state.currentGroup.id, {
      method: "PUT",
      body: JSON.stringify({ name, description })
    });

    showToast(data.message || "Группа обновлена");
    closeModal("groupModal");
    await loadGroups();
    await openGroupChat({ ...state.currentGroup, name, description });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addMemberToGroup() {
  if (!state.currentGroup) return;

  try {
    const handle = normalizeHandle($("groupMemberHandleInput").value);

    if (!handle) {
      showToast("Введи юзернейм", true);
      return;
    }

    const data = await api("/groups/" + state.currentGroup.id + "/members", {
      method: "POST",
      body: JSON.stringify({ handle })
    });

    showToast(data.message || "Участник добавлен");
    $("groupMemberHandleInput").value = "";
    openGroupManager();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function initChatPage() {
  if (!state.token) {
    window.location.href = "index.html";
    return;
  }

  try {
    await loadProfile();
    await loadFriends();
    await loadGroups();
    connectSocket();

    $("logoutBtn")?.addEventListener("click", logout);
    $("friendSearchBtn")?.addEventListener("click", searchUsers);
    $("createGroupBtn")?.addEventListener("click", createGroup);
    $("sendBtn")?.addEventListener("click", sendMessage);
    $("messageInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    $("openProfileBtn")?.addEventListener("click", () => openModal("profileModal"));
    $("closeProfileBtn")?.addEventListener("click", () => closeModal("profileModal"));
    $("saveProfileBtn")?.addEventListener("click", saveProfile);

    $("manageGroupBtn")?.addEventListener("click", openGroupManager);
    $("closeGroupBtn")?.addEventListener("click", () => closeModal("groupModal"));
    $("saveGroupBtn")?.addEventListener("click", saveGroup);
    $("addGroupMemberBtn")?.addEventListener("click", addMemberToGroup);

    $("openSidebarBtn")?.addEventListener("click", () => toggleSidebar(true));
    $("closeSidebarBtn")?.addEventListener("click", () => toggleSidebar(false));
  } catch (err) {
    showToast(err.message, true);
    if (String(err.message).toLowerCase().includes("токен")) {
      logout();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (isChatPage) {
    initChatPage();
  } else {
    initAuthPage();
  }
});
