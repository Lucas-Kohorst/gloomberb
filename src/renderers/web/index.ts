import { startLocalWebClient } from "./server";

const port = process.env.PORT ? Number(process.env.PORT) : undefined;
const client = await startLocalWebClient({ port });

process.on("SIGINT", () => {
  client.stop();
  process.exit(0);
});
