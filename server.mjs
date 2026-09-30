import { createApp } from "./app.mjs";

const server = createApp();
server.listen(Number(process.env.PORT || 3000), () => {
  console.log(`Nova Omnis listening on port ${server.address().port}`);
});
