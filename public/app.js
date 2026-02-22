const token = localStorage.getItem("token")

if (location.pathname.includes("chat") && !token)
  window.location.href = "index.html"

function login() {
  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: username.value,
      password: password.value
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.token) {
      localStorage.setItem("token", data.token)
      window.location.href = "chat.html"
    } else alert(data.error)
  })
}

function register() {
  fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: username.value,
      password: password.value
    })
  })
  .then(r => r.json())
  .then(data => alert(data.ok ? "Registered!" : data.error))
}

let currentUser = null
let currentChat = null

if (token) {
  const payload = JSON.parse(atob(token.split(".")[1]))
  currentUser = payload.username
}

const ws = new WebSocket(
  location.protocol === "https:"
    ? "wss://" + location.host
    : "ws://" + location.host
)

ws.onopen = () => {
  if (currentUser) {
    ws.send(JSON.stringify({
      type: "join",
      username: currentUser
    }))
    loadFriends()
  }
}

ws.onmessage = e => {
  const data = JSON.parse(e.data)
  if (data.type === "privateMessage") {
    if (data.sender === currentChat)
      addMessage(data.sender + ": " + data.text)
  }
}

function loadFriends() {
  fetch("/friends", {
    headers: { Authorization: "Bearer " + token }
  })
  .then(r => r.json())
  .then(friends => {
    friendsList.innerHTML = ""
    friends.forEach(f => {
      const li = document.createElement("li")
      li.textContent = f.user2
      li.onclick = () => openChat(f.user2)
      friendsList.appendChild(li)
    })
  })
}

function openChat(friend) {
  currentChat = friend
  messages.innerHTML = ""

  fetch("/messages/" + friend, {
    headers: { Authorization: "Bearer " + token }
  })
  .then(r => r.json())
  .then(msgs => {
    msgs.forEach(m => addMessage(m.sender + ": " + m.text))
  })
}

function addFriend() {
  fetch("/add-friend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ friend: friendInput.value })
  }).then(() => {
    friendInput.value = ""
    loadFriends()
  })
}

function send() {
  if (!currentChat) {
    alert("Select friend")
    return
  }

  ws.send(JSON.stringify({
    type: "privateMessage",
    sender: currentUser,
    to: currentChat,
    text: text.value
  }))

  addMessage("Me: " + text.value)
  text.value = ""
}

function addMessage(t) {
  const div = document.createElement("div")
  div.textContent = t
  messages.appendChild(div)
}
