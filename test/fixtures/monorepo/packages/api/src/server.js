const express = require("express");
const app = express();
app.get("/api/customers", (req, res) => res.json([]));
app.listen(4000);
