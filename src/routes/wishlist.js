export default async function wishlistRoutes(fastify, options) {
  const storeService = options.storeService;
  const firebase = options.firebase;

  // Schedule wishlist reminder email
  fastify.post("/api/wishlist/schedule-reminder", async (request, reply) => {
    try {
      const { userId, userEmail, userName, product, addedAt } = request.body;

      if (!userId || !userEmail || !product) {
        return reply.status(400).send({
          error: "User ID, email, and product data are required",
        });
      }

      const doc = await firebase.db
        .collection("settings")
        .doc("wishlistEmail")
        .get();
      const settings = doc.exists
        ? doc.data()
        : { delayHours: 12, enabled: true };

      if (!settings.enabled) {
        return {
          success: true,
          message: "Wishlist emails are currently disabled",
          scheduled: false,
        };
      }

      const sendAt =
        (addedAt || Date.now()) + settings.delayHours * 60 * 60 * 1000;

      await storeService.addToWishlistQueue(userId, product.id, {
        userEmail,
        userName,
        product,
        addedAt: addedAt || Date.now(),
        sendAt,
      });

      return {
        success: true,
        message: `Wishlist reminder scheduled for ${new Date(sendAt).toISOString()}`,
        scheduled: true,
        sendAt,
      };
    } catch (error) {
      fastify.log.error("Failed to schedule wishlist reminder:", error);
      return reply.status(500).send({
        error: "Failed to schedule wishlist reminder",
        message: error.message,
      });
    }
  });

  // Cancel scheduled wishlist reminder
  fastify.delete(
    "/api/wishlist/cancel-reminder/:userId/:productId",
    async (request, reply) => {
      try {
        const { userId, productId } = request.params;

        const exists = await storeService.isInWishlistQueue(userId, productId);

        if (exists) {
          await storeService.removeFromWishlistQueue(userId, productId);
          return {
            success: true,
            message: "Wishlist reminder cancelled",
          };
        }

        return {
          success: true,
          message: "No reminder found to cancel",
        };
      } catch (error) {
        fastify.log.error("Failed to cancel wishlist reminder:", error);
        return reply.status(500).send({
          error: "Failed to cancel wishlist reminder",
          message: error.message,
        });
      }
    }
  );
}
