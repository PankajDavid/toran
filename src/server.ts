import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 8080;
createApp().listen(port, () => {
  console.log(`UtsavIQ listening on port ${port}`);
});
