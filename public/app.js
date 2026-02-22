const ws = new WebSocket("ws://localhost:3000")
const username = localStorage.getItem("username") || "User"+Math.floor(Math.random()*1000)

ws.onmessage = e=>{
 const data = JSON.parse(e.data)
 if(data.banned) return alert("You are banned")
 addMessage(data)
}

function send(){
 const text = document.getElementById("text").value
 ws.send(JSON.stringify({
   sender:username,
   text:text
 }))
 document.getElementById("text").value=""
}

function addMessage(data){
 const div = document.createElement("div")
 div.innerText = data.sender+": "+data.text
 document.getElementById("messages").appendChild(div)
}
