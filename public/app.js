const token = localStorage.getItem("token")

if (!token && location.pathname.includes("chat"))
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
  .then(data => alert(data.ok ? "Registered" : data.error))
}

let currentUser
fetch("/verify", {
  headers: { Authorization: "Bearer " + token }
})
.then(r => r.json())
.then(data => currentUser = data.user)

const ws = new WebSocket(
  location.protocol === "https:"
    ? "wss://" + location.host
    : "ws://" + location.host
)

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "join",
    username: currentUser
  }))
}

ws.onmessage = e => {
  const data = JSON.parse(e.data)
  if (data.type === "privateMessage")
    addMessage(data.sender + ": " + data.text)
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
      li.onclick = () => currentChat = f.user2
      friendsList.appendChild(li)
    })
  })
}

function addFriend() {
  fetch("/add-friend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({
      friend: addFriendInput.value
    })
  }).then(loadFriends)
}

function send() {
  ws.send(JSON.stringify({
    type: "privateMessage",
    sender: currentUser,
    to: currentChat,
    text: text.value
  }))
  addMessage("Me: " + text.value)
  text.value = ""
}

function addMessage(textMsg) {
  const div = document.createElement("div")
  div.textContent = textMsg
  messages.appendChild(div)
}
