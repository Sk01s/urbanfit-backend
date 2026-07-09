function verifyCronRequest(request) {
  const authHeader = request.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }

  return true;
}

export default async function cronRoutes(fastify, options) {
  const storeService = options.storeService;
  const emailService = options.emailService;

  // Process wishlist email queue
  fastify.get("/api/cron/process-wishlist-emails", async (request, reply) => {
    if (!verifyCronRequest(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      console.log("Processing wishlist email queue...");

      const pendingEmails = await storeService.getPendingWishlistEmails();
      let sent = 0;
      let failed = 0;

      for (const item of pendingEmails) {
        try {
          await emailService.sendWishlistReminder(
            item.userEmail,
            item.userName,
            item.product
          );
          await storeService.deleteWishlistQueueItem(item.id);
          sent++;
          console.log(
            `Sent wishlist reminder to ${item.userEmail} for product ${item.product.name}`
          );
        } catch (error) {
          console.error(
            `Failed to send wishlist reminder for ${item.id}:`,
            error
          );
          failed++;
        }
      }

      console.log(
        `Wishlist email queue processed. Sent: ${sent}, Failed: ${failed}`
      );

      return {
        success: true,
        processed: pendingEmails.length,
        sent,
        failed,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error("Failed to process wishlist email queue:", error);
      return reply.status(500).send({
        error: "Failed to process wishlist email queue",
        message: error.message,
      });
    }
  });

  // Cleanup expired OTPs
  fastify.get("/api/cron/cleanup-otp", async (request, reply) => {
    if (!verifyCronRequest(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      console.log("Cleaning up expired OTPs and attempts...");

      const [expiredOtps, expiredVerifications, oldAttempts] = await Promise.all([
        storeService.cleanupExpiredOtps(),
        storeService.cleanupExpiredVerifications(),
        storeService.cleanupOldOtpAttempts(),
      ]);

      console.log(
        `Cleanup complete. Expired OTPs: ${expiredOtps}, Expired verifications: ${expiredVerifications}, Old attempts: ${oldAttempts}`
      );

      return {
        success: true,
        cleaned: {
          expiredOtps,
          expiredVerifications,
          oldAttempts,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error("Failed to cleanup OTPs:", error);
      return reply.status(500).send({
        error: "Failed to cleanup OTPs",
        message: error.message,
      });
    }
  });
}
