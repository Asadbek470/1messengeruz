const token = localStorage.getItem("token");
const isChatPage = location.pathname.includes("chat");
const isSupportPage = location.pathname.includes("support");

const state = {
  me: null,
  ws: null,
  currentChat: null,
  currentGroup: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false
};

function $(id) {
  return document.getElementById(id);
}

function showToast(text, isError = false) {
  const toast = $("toast");
  if (!toast) return alert(text);
  toast.textContent = text;
  toast.style.color = isError ? "#ea4d4d" : "";
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.color = "";
  }, 2600);
}

function normalizeHandle(value = "") {
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function decodeToken(jwtToken) {
  try {
    return JSON.parse(atob(jwtToken.split(".")[1]));
  } catch {
    return null;
  }
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function applyTheme(theme) {
  document.body.classList.toggle("theme-dark", theme === "dark");
  localStorage.setItem("theme", theme);
}

function toggleTheme() {
  const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
  applyTheme(next);
}

function initTheme() {
  const saved = localStorage.getItem("theme") || "light";
  applyTheme(saved);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

function openModal(id) {
  $(id)?.classList.remove("hidden");
}

function closeModal(id) {
  $(id)?.classList.add("hidden");
}

function bindModalClosers() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
}

function logout() {
  localStorage.removeItem("token");
  location.href = "index.html";
}

function setAvatar(mediaEl, fallbackEl, url, fallbackText = "U") {
  if (!mediaEl || !fallbackEl) return;
  if (url) {
    mediaEl.src = url;
    mediaEl.style.display = "block";
    fallbackEl.style.display = "none";
  } else {
    mediaEl.removeAttribute("src");
    mediaEl.style.display = "none";
    fallbackEl.textContent = fallbackText.slice(0, 1).toUpperCase();
    fallbackEl.style.display = "grid";
  }
}

async function fileToBase64(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createMediaHtml(message) {
  if (message.mediaType === "image" && message.mediaUrl) {
    return `
      <div class="message-media">
        <img src="${escapeHtml(message.mediaUrl)}" alt="media" />
      </div>
    `;
  }

  if (message.mediaType === "video" && message.mediaUrl) {
    return `
      <div class="message-media">
        <video src="${escapeHtml(message.mediaUrl)}" controls></video>
      </div>
    `;
  }

  if (message.mediaType === "audio" && message.mediaUrl) {
    return `
      <audio class="message-audio" controls src="${escapeHtml(message.mediaUrl)}"></audio>
    `;
  }

  return "";
}

function renderMessage(msg) {
  const mine = msg.senderHandle === state.me.handle;
  const wrapper = document.createElement("div");
  wrapper.className = `message-row ${mine ? "mine" : "other"}`;

  wrapper.innerHTML = `
    <div class="message-bubble">
      <div class="message-meta">${mine ? "Вы" : escapeHtml(msg.senderName || msg.senderHandle)} • ${formatTime(msg.createdAt)}</div>
      ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ""}
      ${createMediaHtml(msg)}
    </div>
  `;
  return wrapper;
}

function renderUserCard(user, withAdd = false) {
  const div = document.createElement("div");
  div.className = "list-card";
  div.innerHTML = `
    <div class="list-title">${escapeHtml(user.displayName || user.handle)}</div>
    <div class="list-subtitle">@${escapeHtml(user.handle)}</div>
    <div class="list-subtitle">${escapeHtml(user.bio || "Без описания")}</div>
    <div class="item-actions">
      ${withAdd ? `<button class="primary-btn add-user-btn" data-handle="${escapeHtml(user.handle)}" type="button">Добавить</button>` : ""}
      <button class="secondary-btn view-user-btn" data-handle="${escapeHtml(user.handle)}" type="button">Смотреть профиль</button>
    </div>
  `;
  return div;
}

function renderGroupCard(group) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "list-card";
  btn.innerHTML = `
    <div class="list-title">${escapeHtml(group.name)}</div>
    <div class="list-subtitle">${escapeHtml(group.role || "")}</div>
    <div class="list-subtitle">${escapeHtml(group.description || "Без описания")}</div>
  `;
  btn.addEventListener("click", () => openGroupChat(group));
  return btn;
}

function renderFriendCard(friend) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "list-card";
  btn.innerHTML = `
    <div class="list-title">${escapeHtml(friend.displayName)}</div>
    <div class="list-subtitle">@${escapeHtml(friend.handle)}</div>
    <div class="list-subtitle">${escapeHtml(friend.bio || "Без описания")}</div>
  `;
  btn.addEventListener("click", () => openPrivateChat(friend));
  return btn;
}

function scrollMessages() {
  const box = $("messages");
  if (box) box.scrollTop = box.scrollHeight;
}

function toggleSidebar(force) {
  const sidebar = $("sidebar");
  if (!sidebar) return;
  if (typeof force === "boolean") sidebar.classList.toggle("open", force);
  else sidebar.classList.toggle("open");
}

async function loadProfile() {
  const me = await api("/me");
  state.me = me;

  $("selfName").textContent = me.displayName;
  $("selfHandle").textContent = "@" + me.handle;
  $("selfDob").textContent = me.dob ? `Дата рождения: ${me.dob}` : "Дата рождения не указана";

  setAvatar(
    $("selfAvatar"),
    $("selfAvatarFallback"),
    me.avatarUrl || "",
    me.displayName || me.handle || "U"
  );

  $("profileNameInput").value = me.displayName || "";
  $("profileHandleInput").value = me.handle || "";
  $("profileDobInput").value = me.dob || "";
  $("profileBioInput").value = me.bio || "";

  setAvatar(
    $("profileAvatarPreview"),
    $("profileAvatarPreviewFallback"),
    me.avatarUrl || "",
    me.displayName || me.handle || "U"
  );
}

async function saveProfile() {
  try {
    const displayName = $("profileNameInput").value.trim();
    const handle = normalizeHandle($("profileHandleInput").value);
    const dob = $("profileDobInput").value;
    const bio = $("profileBioInput").value.trim();
    const avatarFile = $("profileAvatarInput").files[0];

    let avatarBase64 = null;
    let avatarKind = null;

    if (avatarFile) {
      avatarBase64 = await fileToBase64(avatarFile);
      avatarKind = avatarFile.type.startsWith("video/") ? "video" : "image";
    }

    const result = await api("/me", {
      method: "PUT",
      body: JSON.stringify({
        displayName,
        handle,
        dob,
        bio,
        avatarBase64,
        avatarKind
      })
    });

    if (result.token) {
      localStorage.setItem("token", result.token);
    }

    await loadProfile();
    closeModal("profileModal");
    showToast("Профиль обновлён");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function searchUsers() {
  try {
    const q = normalizeHandle($("friendSearchInput").value);
    if (!q) {
      showToast("Введи юзернейм", true);
      return;
    }

    const users = await api(`/users/search?q=${encodeURIComponent(q)}`);
    const box = $("searchResults");
    box.innerHTML = "";

    if (!users.length) {
      box.innerHTML = `<div class="list-card">Никого не найдено</div>`;
      return;
    }

    users.forEach((user) => {
      const card = renderUserCard(user, true);
      box.appendChild(card);
    });

    box.querySelectorAll(".add-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("/add-friend", {
            method: "POST",
            body: JSON.stringify({ handle: btn.dataset.handle })
          });
          showToast("Друг добавлен");
          await loadFriends();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });

    box.querySelectorAll(".view-user-btn").forEach((btn) => {
      btn.addEventListener("click", () => openUserProfile(btn.dataset.handle));
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadFriends() {
  try {
    const friends = await api("/friends");
    const box = $("friendsList");
    box.innerHTML = "";

    if (!friends.length) {
      box.innerHTML = `<div class="list-card">Пока нет друзей</div>`;
      return;
    }

    friends.forEach((friend) => box.appendChild(renderFriendCard(friend)));
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadGroups() {
  try {
    const groups = await api("/groups");
    const box = $("groupsList");
    box.innerHTML = "";

    if (!groups.length) {
      box.innerHTML = `<div class="list-card">Пока нет групп</div>`;
      return;
    }

    groups.forEach((group) => box.appendChild(renderGroupCard(group)));
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadStories() {
  try {
    const stories = await api("/stories");
    const box = $("storiesList");
    box.innerHTML = "";

    if (!stories.length) {
      box.innerHTML = `<div class="list-card">Историй пока нет</div>`;
      return;
    }

    stories.forEach((story) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "story-card";
      card.innerHTML = `
        <div class="story-item-head">
          <div class="list-title">${escapeHtml(story.displayName || story.handle)}</div>
        </div>
        <div class="story-preview">
          ${
            story.mediaType === "video"
              ? `<video src="${escapeHtml(story.mediaUrl)}" muted></video>`
              : `<img src="${escapeHtml(story.mediaUrl)}" alt="story" />`
          }
        </div>
        <div class="story-caption">${escapeHtml(story.caption || "")}</div>
      `;
      card.addEventListener("click", () => openStoryViewer(story));
      box.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function createStory() {
  try {
    const caption = $("storyTextInput").value.trim();
    const file = $("storyFileInput").files[0];

    if (!file) {
      showToast("Выбери файл для истории", true);
      return;
    }

    const mediaBase64 = await fileToBase64(file);
    const mediaType = file.type.startsWith("video/") ? "video" : "image";

    await api("/stories", {
      method: "POST",
      body: JSON.stringify({ caption, mediaBase64, mediaType })
    });

    $("storyTextInput").value = "";
    $("storyFileInput").value = "";
    showToast("История опубликована");
    await loadStories();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openPrivateChat(friend) {
  try {
    state.currentChat = { type: "private", handle: friend.handle };
    state.currentGroup = null;

    $("chatTitle").textContent = friend.displayName;
    $("chatSubtitle").textContent = "@" + friend.handle;
    $("manageGroupBtn").classList.add("hidden");
    $("viewProfileBtn").classList.remove("hidden");
    $("viewProfileBtn").dataset.handle = friend.handle;

    const messages = await api(`/messages/private/${encodeURIComponent(friend.handle)}`);
    const box = $("messages");
    box.innerHTML = "";

    if (!messages.length) {
      box.innerHTML = `<div class="empty-state">Начните диалог первым</div>`;
      return;
    }

    messages.forEach((m) => box.appendChild(renderMessage(m)));
    scrollMessages();
    toggleSidebar(false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openGroupChat(group) {
  try {
    state.currentChat = { type: "group", id: group.id };
    state.currentGroup = group;

    $("chatTitle").textContent = group.name;
    $("chatSubtitle").textContent = group.description || group.role || "Группа";
    $("manageGroupBtn").classList.remove("hidden");
    $("viewProfileBtn").classList.add("hidden");

    const messages = await api(`/groups/${group.id}/messages`);
    const box = $("messages");
    box.innerHTML = "";

    if (!messages.length) {
      box.innerHTML = `<div class="empty-state">В этой группе пока нет сообщений</div>`;
      return;
    }

    messages.forEach((m) => box.appendChild(renderMessage(m)));
    scrollMessages();
    toggleSidebar(false);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function sendTextMessage() {
  const text = $("messageInput").value.trim();
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
  } else {
    state.ws.send(JSON.stringify({
      type: "groupMessage",
      groupId: state.currentChat.id,
      text
    }));
  }

  $("messageInput").value = "";
}

async function sendMediaMessage(file) {
  try {
    if (!state.currentChat) {
      showToast("Сначала выбери чат", true);
      return;
    }

    const mediaBase64 = await fileToBase64(file);
    const mediaType = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
      ? "image"
      : null;

    if (!mediaType) {
      showToast("Поддерживаются только фото и видео", true);
      return;
    }

    if (state.currentChat.type === "private") {
      state.ws.send(JSON.stringify({
        type: "privateMessage",
        to: state.currentChat.handle,
        text: "",
        mediaBase64,
        mediaType
      }));
    } else {
      state.ws.send(JSON.stringify({
        type: "groupMessage",
        groupId: state.currentChat.id,
        text: "",
        mediaBase64,
        mediaType
      }));
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function toggleVoiceRecording() {
  try {
    if (!state.currentChat) {
      showToast("Сначала выбери чат", true);
      return;
    }

    const btn = $("recordVoiceBtn");

    if (state.isRecording && state.mediaRecorder) {
      state.mediaRecorder.stop();
      state.isRecording = false;
      btn.textContent = "🎙";
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.recordedChunks, { type: "audio/webm" });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
      const mediaBase64 = await fileToBase64(file);

      if (state.currentChat.type === "private") {
        state.ws.send(JSON.stringify({
          type: "privateMessage",
          to: state.currentChat.handle,
          text: "",
          mediaBase64,
          mediaType: "audio"
        }));
      } else {
        state.ws.send(JSON.stringify({
          type: "groupMessage",
          groupId: state.currentChat.id,
          text: "",
          mediaBase64,
          mediaType: "audio"
        }));
      }

      stream.getTracks().forEach((t) => t.stop());
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    btn.textContent = "⏹";
  } catch (err) {
    showToast("Нет доступа к микрофону", true);
  }
}

function connectWs() {
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
      if (state.currentChat?.type === "private" &&
          (data.senderHandle === state.currentChat.handle || data.to === state.currentChat.handle)) {
        $("messages").appendChild(renderMessage(data));
        scrollMessages();
      }
      loadFriends();
    }

    if (data.type === "groupMessage") {
      if (state.currentChat?.type === "group" && Number(state.currentChat.id) === Number(data.groupId)) {
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
    setTimeout(connectWs, 1500);
  };
}

async function createGroup() {
  try {
    const name = $("newGroupName").value.trim();
    const description = $("newGroupDescription").value.trim();
    const mediaFile = $("newGroupMedia").files[0];

    if (!name) {
      showToast("Введите название группы", true);
      return;
    }

    let mediaBase64 = null;
    let mediaType = null;

    if (mediaFile) {
      mediaBase64 = await fileToBase64(mediaFile);
      mediaType = mediaFile.type.startsWith("video/") ? "video" : "image";
    }

    await api("/groups", {
      method: "POST",
      body: JSON.stringify({ name, description, mediaBase64, mediaType })
    });

    $("newGroupName").value = "";
    $("newGroupDescription").value = "";
    $("newGroupMedia").value = "";
    showToast("Группа создана");
    await loadGroups();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openGroupManager() {
  try {
    if (!state.currentGroup) return;

    const group = await api(`/groups/${state.currentGroup.id}`);
    const members = await api(`/groups/${state.currentGroup.id}/members`);

    $("groupNameInput").value = group.name || "";
    $("groupDescriptionInput").value = group.description || "";

    const box = $("groupMembersList");
    box.innerHTML = "";

    members.forEach((member) => {
      const card = document.createElement("div");
      card.className = "member-card";
      card.innerHTML = `
        <div class="list-title">${escapeHtml(member.displayName)} (@${escapeHtml(member.handle)})</div>
        <div class="list-subtitle">${escapeHtml(member.role)}</div>
        <div class="item-actions">
          <button class="secondary-btn role-btn" data-handle="${escapeHtml(member.handle)}" data-role="admin" type="button">Сделать админом</button>
          <button class="secondary-btn role-btn" data-handle="${escapeHtml(member.handle)}" data-role="member" type="button">Сделать участником</button>
          <button class="secondary-btn owner-btn" data-handle="${escapeHtml(member.handle)}" type="button">Сделать владельцем</button>
        </div>
      `;
      box.appendChild(card);
    });

    box.querySelectorAll(".role-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/groups/${state.currentGroup.id}/role`, {
            method: "POST",
            body: JSON.stringify({
              handle: btn.dataset.handle,
              role: btn.dataset.role
            })
          });
          showToast("Роль обновлена");
          openGroupManager();
          loadGroups();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });

    box.querySelectorAll(".owner-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/groups/${state.currentGroup.id}/transfer-owner`, {
            method: "POST",
            body: JSON.stringify({ handle: btn.dataset.handle })
          });
          showToast("Новый владелец назначен");
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
  try {
    if (!state.currentGroup) return;

    const name = $("groupNameInput").value.trim();
    const description = $("groupDescriptionInput").value.trim();
    const mediaFile = $("groupMediaInput").files[0];

    let mediaBase64 = null;
    let mediaType = null;

    if (mediaFile) {
      mediaBase64 = await fileToBase64(mediaFile);
      mediaType = mediaFile.type.startsWith("video/") ? "video" : "image";
    }

    await api(`/groups/${state.currentGroup.id}`, {
      method: "PUT",
      body: JSON.stringify({ name, description, mediaBase64, mediaType })
    });

    showToast("Группа обновлена");
    closeModal("groupModal");
    await loadGroups();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addGroupMember() {
  try {
    if (!state.currentGroup) return;
    const handle = normalizeHandle($("groupMemberHandleInput").value);

    if (!handle) {
      showToast("Введи юзернейм", true);
      return;
    }

    await api(`/groups/${state.currentGroup.id}/members`, {
      method: "POST",
      body: JSON.stringify({ handle })
    });

    $("groupMemberHandleInput").value = "";
    showToast("Участник добавлен");
    openGroupManager();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function transferOwnerPrompt() {
  try {
    if (!state.currentGroup) return;
    const handle = normalizeHandle(prompt("Введите @username нового владельца") || "");
    if (!handle) return;

    await api(`/groups/${state.currentGroup.id}/transfer-owner`, {
      method: "POST",
      body: JSON.stringify({ handle })
    });

    showToast("Владелец изменён");
    openGroupManager();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openUserProfile(handle) {
  try {
    const user = await api(`/users/${encodeURIComponent(handle)}`);

    $("viewerTitle").textContent = `${user.displayName} (@${user.handle})`;
    $("viewerBody").innerHTML = `
      <div class="stack">
        ${
          user.avatarUrl
            ? `<div class="message-media">
                ${user.avatarType === "video"
                  ? `<video controls src="${escapeHtml(user.avatarUrl)}"></video>`
                  : `<img src="${escapeHtml(user.avatarUrl)}" alt="avatar" />`
                }
               </div>`
            : ""
        }
        <div class="list-subtitle">Дата рождения: ${escapeHtml(user.dob || "не указана")}</div>
        <div class="list-subtitle">Описание: ${escapeHtml(user.bio || "нет описания")}</div>
      </div>
    `;
    openModal("viewerModal");
  } catch (err) {
    showToast(err.message, true);
  }
}

function openStoryViewer(story) {
  $("viewerTitle").textContent = `История ${story.displayName || story.handle}`;
  $("viewerBody").innerHTML = `
    <div class="stack">
      ${
        story.mediaType === "video"
          ? `<video controls autoplay src="${escapeHtml(story.mediaUrl)}"></video>`
          : `<img src="${escapeHtml(story.mediaUrl)}" alt="story" />`
      }
      <div class="list-subtitle">@${escapeHtml(story.handle)}</div>
      <div class="list-subtitle">${escapeHtml(story.caption || "")}</div>
    </div>
  `;
  openModal("viewerModal");
}

async function loadSupportTickets() {
  try {
    const box = $("supportTicketsList");
    if (!box) return;

    const tickets = await api("/support/my");
    box.innerHTML = "";

    if (!tickets.length) {
      box.innerHTML = `<div class="list-card">Пока нет обращений</div>`;
      return;
    }

    tickets.forEach((ticket) => {
      const card = document.createElement("div");
      card.className = "list-card";
      card.innerHTML = `
        <div class="list-title">${escapeHtml(ticket.subject)}</div>
        <div class="list-subtitle">${escapeHtml(ticket.message)}</div>
        <div class="list-subtitle">Статус: ${escapeHtml(ticket.status || "open")}</div>
      `;
      box.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function sendSupportTicket() {
  try {
    const subject = $("supportSubject").value.trim();
    const message = $("supportMessage").value.trim();

    if (!subject || !message) {
      showToast("Заполни тему и сообщение", true);
      return;
    }

    await api("/support", {
      method: "POST",
      body: JSON.stringify({ subject, message })
    });

    $("supportSubject").value = "";
    $("supportMessage").value = "";
    showToast("Обращение отправлено");
    await loadSupportTickets();
  } catch (err) {
    showToast(err.message, true);
  }
}

function bindCommon() {
  initTheme();
  bindModalClosers();

  document.querySelectorAll("#themeToggleBtn").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });
}

async function initChatPage() {
  if (!token) {
    location.href = "index.html";
    return;
  }

  try {
    connectWs();
    await loadProfile();
    await loadFriends();
    await loadGroups();
    await loadStories();

    $("logoutBtn").addEventListener("click", logout);
    $("openProfileBtn").addEventListener("click", () => openModal("profileModal"));
    $("saveProfileBtn").addEventListener("click", saveProfile);
    $("friendSearchBtn").addEventListener("click", searchUsers);
    $("createStoryBtn").addEventListener("click", createStory);
    $("createGroupBtn").addEventListener("click", createGroup);
    $("sendBtn").addEventListener("click", sendTextMessage);
    $("attachBtn").addEventListener("click", () => $("chatMediaInput").click());
    $("recordVoiceBtn").addEventListener("click", toggleVoiceRecording);
    $("chatMediaInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) await sendMediaMessage(file);
      e.target.value = "";
    });

    $("messageInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendTextMessage();
    });

    $("manageGroupBtn").addEventListener("click", openGroupManager);
    $("saveGroupBtn").addEventListener("click", saveGroup);
    $("addGroupMemberBtn").addEventListener("click", addGroupMember);
    $("transferOwnerBtn").addEventListener("click", transferOwnerPrompt);
    $("viewProfileBtn").addEventListener("click", () => {
      const handle = $("viewProfileBtn").dataset.handle;
      if (handle) openUserProfile(handle);
    });

    $("openSidebarBtn").addEventListener("click", () => toggleSidebar(true));
    $("closeSidebarBtn").addEventListener("click", () => toggleSidebar(false));
  } catch (err) {
    showToast(err.message, true);
  }
}

async function initSupportPage() {
  if (!token) {
    location.href = "index.html";
    return;
  }

  try {
    await loadSupportTickets();
    $("sendSupportBtn").addEventListener("click", sendSupportTicket);
  } catch (err) {
    showToast(err.message, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindCommon();

  if (isChatPage) initChatPage();
  if (isSupportPage) initSupportPage();
});
