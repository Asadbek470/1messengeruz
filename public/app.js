const token = localStorage.getItem("token")

if (!token && location.pathname.includes("chat"))
  window.location.href = "index.html"

let currentUser = null
let currentChat = null

// Получаем пользователя
fetch("/verify", {
  headers: { Authorization: "Bearer " + token }
})
.then(r => r.json())
.then(data => {
  currentUser = data.user
  loadFriends()
})

// WebSocket
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
  }
}

ws.onmessage = e => {
  const data = JSON.parse(e.data)

  if (data.type === "privateMessage") {
    if (data.sender === currentChat) {
      addMessage(data.sender + ": " + data.text)
    }
  }
}

// ---------------- FRIENDS ----------------

function loadFriends() {
  fetch("/friends", {
    headers: { Authorization: "Bearer " + token }
  })
  .then(r => r.json())
  .then(friends => {
    const list = document.getElementById("friendsList")
    list.innerHTML = ""

    friends.forEach(f => {
      const li = document.createElement("li")
      li.textContent = f.user2

      li.onclick = () => openChat(f.user2)

      list.appendChild(li)
    })
  })
}

function openChat(friend) {
  currentChat = friend
  document.getElementById("messages").innerHTML = ""

  fetch("/chat/" + friend, {
    headers: { Authorization: "Bearer " + token }
  })
  .then(r => r.json())
  .then(messages => {
    messages.forEach(m => {
      addMessage(m.sender + ": " + m.text)
    })
  })
}

function addFriend() {
  const friend = document.getElementById("addFriendInput").value

  fetch("/add-friend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ friend })
  })
  .then(r => r.json())
  .then(() => {
    document.getElementById("addFriendInput").value = ""
    loadFriends()
  })
}

// ---------------- SEND MESSAGE ----------------

function send() {
  if (!currentChat) {
    alert("Select a friend first")
    return
  }

  const textInput = document.getElementById("text")
  const text = textInput.value

  ws.send(JSON.stringify({
    type: "privateMessage",
    sender: currentUser,
    to: currentChat,
    text: text
  }))

  addMessage("Me: " + text)
  textInput.value = ""
}

function addMessage(text) {
  const div = document.createElement("div")
  div.textContent = text
  document.getElementById("messages").appendChild(div)
}
