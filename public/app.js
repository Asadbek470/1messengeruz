<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>One Messenger</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="chat-page">
  <div class="app-layout">
    <aside id="sidebar" class="sidebar">
      <div id="sidebarTopAnchor" class="sidebar-top">
        <div>
          <div class="logo-text">One Messenger</div>
          <div class="sidebar-subtitle">без SIM</div>
        </div>
        <button id="closeSidebarBtn" class="ghost-btn mobile-only" type="button">✕</button>
      </div>

      <section id="profileSection" class="panel">
        <div class="panel-title">Ваш профиль</div>
        <div id="selfName" class="profile-name">Пользователь</div>
        <div id="selfHandle" class="profile-handle">@username</div>
        <div id="selfBio" class="profile-bio">Без описания</div>

        <div class="button-stack">
          <button id="openProfileBtn" class="ghost-btn" type="button">Изменить профиль</button>
          <button id="logoutBtn" class="danger-btn" type="button">Выйти</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">Найти пользователя</div>
        <div class="search-row">
          <input id="friendSearchInput" placeholder="@username" />
          <button id="friendSearchBtn" class="primary-btn" type="button">Найти</button>
        </div>
        <div id="searchResults" class="list-stack"></div>
      </section>

      <section class="panel">
        <div class="panel-title">Создать группу</div>
        <div class="form-stack">
          <input id="newGroupName" placeholder="Название группы" />
          <textarea id="newGroupDescription" rows="2" placeholder="Описание группы"></textarea>
          <button id="createGroupBtn" class="primary-btn full-btn" type="button">Создать группу</button>
        </div>
      </section>

      <section class="panel grow-panel">
        <div id="chatsSection" class="panel-title">Личные чаты</div>
        <div id="privateChatsList" class="list-stack"></div>

        <div id="groupsSection" class="panel-title section-gap">Группы</div>
        <div id="groupsList" class="list-stack"></div>
      </section>
    </aside>

    <main class="chat-main">
      <header class="chat-header">
        <div class="chat-header-left">
          <button id="openSidebarBtn" class="ghost-btn mobile-only" type="button">☰</button>
          <div>
            <div id="chatTitle" class="chat-title">Выберите чат</div>
            <div id="chatSubtitle" class="chat-subtitle">Личные сообщения и группы</div>
          </div>
        </div>

        <button id="manageGroupBtn" class="ghost-btn hidden" type="button">Управление группой</button>
      </header>

      <section id="messages" class="messages-area">
        <div class="empty-state">Выберите личный чат или группу ✨</div>
      </section>

      <footer class="composer">
        <input id="messageInput" placeholder="Напишите сообщение..." />
        <input id="fileInput" type="file" accept="image/*,video/*" class="hidden" />
        <button id="attachBtn" class="ghost-btn" type="button">📎</button>
        <button id="recordVoiceBtn" class="ghost-btn" type="button">🎙</button>
        <button id="sendBtn" class="primary-btn" type="button">Отправить</button>
      </footer>
    </main>
  </div>

  <div id="profileModal" class="modal hidden">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Редактировать профиль</h3>
        <button id="closeProfileBtn" class="ghost-btn" type="button">✕</button>
      </div>

      <div class="form-stack">
        <input id="profileNameInput" placeholder="Отображаемое имя" />
        <input id="profileHandleInput" placeholder="Юзернейм" />
        <input id="firstNameInput" placeholder="Имя" />
        <input id="lastNameInput" placeholder="Фамилия" />
        <input id="middleNameInput" placeholder="Отчество" />
        <input id="birthDateInput" type="date" />
        <input id="profileStickerInput" placeholder="Стикер-статус, например 😎" />
        <textarea id="profileBioInput" rows="4" placeholder="О себе"></textarea>
        <button id="saveProfileBtn" class="primary-btn full-btn" type="button">Сохранить</button>
      </div>
    </div>
  </div>

  <div id="groupModal" class="modal hidden">
    <div class="modal-card modal-wide">
      <div class="modal-header">
        <h3>Управление группой</h3>
        <button id="closeGroupBtn" class="ghost-btn" type="button">✕</button>
      </div>

      <div class="form-stack">
        <input id="groupNameInput" placeholder="Название группы" />
        <textarea id="groupDescriptionInput" rows="3" placeholder="Описание группы"></textarea>
        <button id="saveGroupBtn" class="primary-btn full-btn" type="button">Сохранить группу</button>

        <div class="divider"></div>

        <div class="panel-title">Добавить участника</div>
        <div class="search-row">
          <input id="groupMemberHandleInput" placeholder="@username" />
          <button id="addGroupMemberBtn" class="primary-btn" type="button">Добавить</button>
        </div>

        <div class="panel-title">Участники</div>
        <div id="groupMembersList" class="list-stack"></div>
      </div>
    </div>
  </div>

  <nav class="bottom-nav">
    <button id="navChatsBtn" class="bottom-nav-btn active" type="button">
      <span>💬</span>
      <small>Чаты</small>
    </button>
    <button id="navGroupsBtn" class="bottom-nav-btn" type="button">
      <span>👥</span>
      <small>Группы</small>
    </button>
    <button id="navProfileBtn" class="bottom-nav-btn" type="button">
      <span>🙍</span>
      <small>Профиль</small>
    </button>
    <button id="navMenuBtn" class="bottom-nav-btn" type="button">
      <span>⚙️</span>
      <small>Меню</small>
    </button>
  </nav>

  <div id="toast" class="toast"></div>
  <script src="app.js"></script>
</body>
</html>
