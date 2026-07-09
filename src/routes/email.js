export default async function emailRoutes(fastify, options) {
  const emailService = options.emailService;

  // Send order confirmation emails (customer + admin)
  fastify.post("/api/email/order-confirmation", async (request, reply) => {
    try {
      const { order } = request.body;

      if (!order || !order.id) {
        return reply.status(400).send({
          error: "Order data is required",
        });
      }

      const [customerResult, adminResult] = await Promise.all([
        emailService.sendOrderConfirmationToCustomer(order),
        emailService.sendOrderNotificationToAdmin(order),
      ]);

      return {
        success: true,
        customer: customerResult,
        admin: adminResult,
      };
    } catch (error) {
      fastify.log.error("Failed to send order confirmation emails:", error);
      return reply.status(500).send({
        error: "Failed to send order confirmation emails",
        message: error.message,
      });
    }
  });

  // Send wishlist reminder email
  fastify.post("/api/email/wishlist-reminder", async (request, reply) => {
    try {
      const { userEmail, userName, product } = request.body;

      if (!userEmail || !product) {
        return reply.status(400).send({
          error: "User email and product data are required",
        });
      }

      const result = await emailService.sendWishlistReminder(
        userEmail,
        userName,
        product
      );

      return {
        success: result.success,
        data: result,
      };
    } catch (error) {
      fastify.log.error("Failed to send wishlist reminder:", error);
      return reply.status(500).send({
        error: "Failed to send wishlist reminder",
        message: error.message,
      });
    }
  });
}
