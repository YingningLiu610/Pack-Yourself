const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);

app.use(express.static("public"));

io.on("connection", (socket) => {

  console.log("client connected");

  socket.on("capture", (data) => {

    socket.broadcast.emit("capture", data);

  });

});

server.listen(3000, () => {
  console.log("server running on port 3000");
});