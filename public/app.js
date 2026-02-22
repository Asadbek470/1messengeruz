let currentUser = prompt("Username?")
let currentChatId = null

const ws = new WebSocket(
  window.location.protocol === "https:"
    ? "wss://" + window.location.host
    : "ws://" + window.location.host
)

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "join",
    username: currentUser
  }))
  loadChats()
}

ws.onmessage = e => {
  const data = JSON.parse(e.data)

  if (data.type === "newMessage" && data.chatId == currentChatId) {
    addMessage(data.sender + ": " + data.text)
  }
}

function loadChats() {
  fetch("/user-chats/" + currentUser)
    .then(r => r.json())
    .then(chats => {
      const list = document.getElementById("chatList")
      list.innerHTML = ""

      chats.forEach(chat => {
        const li = document.createElement("li")
        li.textContent = chat.name
        li.onclick = () => {
          currentChatId = chat.id
          document.getElementById("messages").innerHTML = ""
        }
        list.appendChild(li)
      })
    })
}

function send() {
  const text = document.getElementById("text").value

  ws.send(JSON.stringify({
    type: "sendMessage",
    chatId: currentChatId,
    sender: currentUser,
    text: text
  }))

  addMessage("Me: " + text)
  document.getElementById("text").value = ""
}

function addMessage(text) {
  const div = document.createElement("div")
  div.textContent = text
  document.getElementById("messages").appendChild(div)
}

function createGroup() {
  const name = prompt("Group name?")
  fetch("/create-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      type: "group",
      members: [currentUser]
    })
  }).then(loadChats)
}

function createChannel() {
  const name = prompt("Channel name?")
  fetch("/create-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      type: "channel",
      members: [currentUser]
    })
  }).then(loadChats)
}
