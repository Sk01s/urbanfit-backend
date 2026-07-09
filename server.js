import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";

const fastify = Fastify({
  logger: true,
});

await fastify.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

// Import services
const firebase = (await import("./src/services/firebaseAdmin.js")).default;
const backblazeB2 = (await import("./src/services/backblazeB2.js")).default;
const emailService = (await import("./src/services/emailService.js")).default;
const storeService = (await import("./src/services/storeService.js")).default;

emailService.initialize();
storeService.initialize(firebase.db);

const routeOptions = { firebase, backblazeB2, emailService, storeService };

// Import and register route plugins
const routes = await Promise.all([
  import("./src/routes/upload.js"),
  import("./src/routes/email.js"),
  import("./src/routes/admin.js"),
  import("./src/routes/wishlist.js"),
  import("./src/routes/shipping.js"),
  import("./src/routes/orders.js"),
  import("./src/routes/cron.js"),
  import("./src/routes/storefront.js"),
]);

for (const routeModule of routes) {
  await fastify.register(routeModule.default, routeOptions);
}

fastify.get("/", (request, reply) => {
  return { hello: "world" };
});

fastify.get("/health", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({
    error: "Internal Server Error",
    message: error.message,
  });
});

const isVercel = process.env.VERCEL === "1";

if (!isVercel) {
  const start = async () => {
    try {
      const port = process.env.PORT || 3001;
      await fastify.listen({ port, host: "0.0.0.0" });
      console.log(`Server running on port ${port}`);
    } catch (error) {
      fastify.log.error(error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, shutting down gracefully");
    await fastify.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Received SIGINT, shutting down gracefully");
    await fastify.close();
    process.exit(0);
  });

  start();
}

export default async function handler(req, res) {
  await fastify.ready();
  fastify.server.emit("request", req, res);
}
