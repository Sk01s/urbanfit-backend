function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function adminRoutes(fastify, options) {
  const storeService = options.storeService;
  const emailService = options.emailService;
  const firebase = options.firebase;

  // Send admin OTP
  fastify.post("/api/admin/send-otp", async (request, reply) => {
    try {
      const { adminId, adminEmail, adminName } = request.body;

      if (!adminId || !adminEmail) {
        return reply.status(400).send({
          error: "Admin ID and email are required",
        });
      }

      const attempts = await storeService.getAdminOtpAttempts(adminId);

      if (attempts >= 5) {
        return reply.status(429).send({
          error: "Daily OTP limit exceeded. Please try again tomorrow.",
        });
      }

      const otp = generateOtp();
      const expiresAt = Date.now() + 20 * 60 * 1000;

      await storeService.storeAdminOtp(adminId, otp, adminEmail, expiresAt);
      await storeService.incrementAdminOtpAttempts(adminId);

      const result = await emailService.sendAdminOtp(adminEmail, adminName, otp);

      if (!result.success) {
        return reply.status(500).send({
          error: "Failed to send OTP email",
          message: result.error,
        });
      }

      return {
        success: true,
        message: "OTP sent successfully",
        expiresIn: 20 * 60,
      };
    } catch (error) {
      fastify.log.error("Failed to send admin OTP:", error);
      return reply.status(500).send({
        error: "Failed to send admin OTP",
        message: error.message,
      });
    }
  });

  // Verify admin OTP
  fastify.post("/api/admin/verify-otp", async (request, reply) => {
    try {
      const { adminId, otp } = request.body;

      if (!adminId || !otp) {
        return reply.status(400).send({
          error: "Admin ID and OTP are required",
        });
      }

      const storedOtp = await storeService.getAdminOtp(adminId);

      if (!storedOtp) {
        return reply.status(400).send({
          error: "No OTP found. Please request a new one.",
          code: "OTP_NOT_FOUND",
        });
      }

      if (Date.now() > storedOtp.expiresAt) {
        await storeService.deleteAdminOtp(adminId);
        return reply.status(400).send({
          error: "OTP has expired. Please request a new one.",
          code: "OTP_EXPIRED",
        });
      }

      if (storedOtp.otp !== otp) {
        return reply.status(400).send({
          error: "Invalid OTP. Please try again.",
          code: "OTP_INVALID",
        });
      }

      const verificationExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
      await storeService.storeAdminVerification(
        adminId,
        Date.now(),
        verificationExpiry
      );

      await storeService.deleteAdminOtp(adminId);

      return {
        success: true,
        message: "OTP verified successfully",
        verificationExpiresAt: verificationExpiry,
      };
    } catch (error) {
      fastify.log.error("Failed to verify admin OTP:", error);
      return reply.status(500).send({
        error: "Failed to verify OTP",
        message: error.message,
      });
    }
  });

  // Check admin verification status
  fastify.get(
    "/api/admin/verification-status/:adminId",
    async (request, reply) => {
      try {
        const { adminId } = request.params;

        if (!adminId) {
          return reply.status(400).send({
            error: "Admin ID is required",
          });
        }

        const verification = await storeService.getAdminVerification(adminId);

        if (!verification) {
          return {
            success: true,
            verified: false,
            message: "Admin not verified",
          };
        }

        if (Date.now() > verification.expiresAt) {
          await storeService.deleteAdminVerification(adminId);
          return {
            success: true,
            verified: false,
            message: "Verification expired",
          };
        }

        return {
          success: true,
          verified: true,
          verifiedAt: verification.verifiedAt,
          expiresAt: verification.expiresAt,
        };
      } catch (error) {
        fastify.log.error("Failed to check verification status:", error);
        return reply.status(500).send({
          error: "Failed to check verification status",
          message: error.message,
        });
      }
    }
  );

  // Get wishlist email settings
  fastify.get("/api/admin/settings/wishlist-email", async (request, reply) => {
    try {
      const doc = await firebase.db
        .collection("settings")
        .doc("wishlistEmail")
        .get();
      const settings = doc.exists
        ? doc.data()
        : { delayHours: 12, enabled: true };

      return {
        success: true,
        data: settings,
      };
    } catch (error) {
      fastify.log.error("Failed to get wishlist email settings:", error);
      return reply.status(500).send({
        error: "Failed to get settings",
        message: error.message,
      });
    }
  });

  // Update wishlist email settings
  fastify.put("/api/admin/settings/wishlist-email", async (request, reply) => {
    try {
      const { delayHours, enabled } = request.body;

      if (delayHours !== undefined && (delayHours < 1 || delayHours > 168)) {
        return reply.status(400).send({
          error: "Delay hours must be between 1 and 168 (1 week)",
        });
      }

      const updates = {};
      if (delayHours !== undefined) updates.delayHours = delayHours;
      if (enabled !== undefined) updates.enabled = enabled;
      updates.updatedAt = new Date().toISOString();

      await firebase.db
        .collection("settings")
        .doc("wishlistEmail")
        .set(updates, { merge: true });

      return {
        success: true,
        message: "Settings updated successfully",
        data: updates,
      };
    } catch (error) {
      fastify.log.error("Failed to update wishlist email settings:", error);
      return reply.status(500).send({
        error: "Failed to update settings",
        message: error.message,
      });
    }
  });

  // Get all shipping rates
  fastify.get("/api/admin/shipping/rates", async (request, reply) => {
    try {
      const doc = await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .get();

      if (doc.exists) {
        return {
          success: true,
          data: doc.data(),
        };
      }

      return {
        success: true,
        data: {
          rates: [
            { city: "Beirut", rate: 3 },
            { city: "Tripoli", rate: 5 },
            { city: "Sidon", rate: 5 },
            { city: "Tyre", rate: 6 },
            { city: "Jounieh", rate: 4 },
            { city: "Byblos", rate: 5 },
            { city: "Baalbek", rate: 7 },
            { city: "Zahle", rate: 6 },
            { city: "Nabatieh", rate: 6 },
            { city: "Batroun", rate: 5 },
          ],
          defaultRate: 5,
          enabled: true,
        },
      };
    } catch (error) {
      fastify.log.error("Failed to get shipping rates:", error);
      return reply.status(500).send({
        error: "Failed to get shipping rates",
        message: error.message,
      });
    }
  });

  // Update all shipping rates
  fastify.put("/api/admin/shipping/rates", async (request, reply) => {
    try {
      const { rates, defaultRate, enabled } = request.body;

      if (!Array.isArray(rates)) {
        return reply.status(400).send({
          error: "Rates must be an array",
        });
      }

      for (const rate of rates) {
        if (!rate.city || typeof rate.rate !== "number" || rate.rate < 0) {
          return reply.status(400).send({
            error:
              "Each rate must have a city name and a non-negative rate number",
          });
        }
      }

      const updates = {
        rates: rates,
        defaultRate: defaultRate || 5,
        enabled: enabled !== false,
        updatedAt: new Date().toISOString(),
      };

      await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .set(updates, { merge: true });

      return {
        success: true,
        message: "Shipping rates updated successfully",
        data: updates,
      };
    } catch (error) {
      fastify.log.error("Failed to update shipping rates:", error);
      return reply.status(500).send({
        error: "Failed to update shipping rates",
        message: error.message,
      });
    }
  });

  // Add a new city rate
  fastify.post("/api/admin/shipping/rates", async (request, reply) => {
    try {
      const { city, rate } = request.body;

      if (!city || typeof rate !== "number" || rate < 0) {
        return reply.status(400).send({
          error: "City name and a non-negative rate are required",
        });
      }

      const doc = await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .get();
      let currentRates = [
        { city: "Beirut", rate: 3 },
        { city: "Tripoli", rate: 5 },
        { city: "Sidon", rate: 5 },
        { city: "Tyre", rate: 6 },
        { city: "Jounieh", rate: 4 },
        { city: "Byblos", rate: 5 },
        { city: "Baalbek", rate: 7 },
        { city: "Zahle", rate: 6 },
        { city: "Nabatieh", rate: 6 },
        { city: "Batroun", rate: 5 },
      ];
      let settings = { defaultRate: 5, enabled: true };

      if (doc.exists) {
        const data = doc.data();
        currentRates = data.rates || currentRates;
        settings = {
          defaultRate: data.defaultRate || 5,
          enabled: data.enabled !== false,
        };
      }

      const existingIndex = currentRates.findIndex(
        (r) => r.city.toLowerCase().trim() === city.toLowerCase().trim()
      );

      if (existingIndex >= 0) {
        currentRates[existingIndex].rate = rate;
      } else {
        currentRates.push({ city: city.trim(), rate });
      }

      const updates = {
        ...settings,
        rates: currentRates,
        updatedAt: new Date().toISOString(),
      };

      await firebase.db.collection("settings").doc("shippingRates").set(updates);

      return {
        success: true,
        message:
          existingIndex >= 0
            ? "Rate updated successfully"
            : "New city rate added successfully",
        data: updates,
      };
    } catch (error) {
      fastify.log.error("Failed to add shipping rate:", error);
      return reply.status(500).send({
        error: "Failed to add shipping rate",
        message: error.message,
      });
    }
  });

  // Delete a city rate
  fastify.delete("/api/admin/shipping/rates/:city", async (request, reply) => {
    try {
      const { city } = request.params;

      const doc = await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .get();

      if (!doc.exists) {
        return reply.status(404).send({
          error: "No shipping rates configured",
        });
      }

      const data = doc.data();
      const currentRates = data.rates || [];

      const cityLower = city.toLowerCase().trim();
      const newRates = currentRates.filter(
        (r) => r.city.toLowerCase().trim() !== cityLower
      );

      if (newRates.length === currentRates.length) {
        return reply.status(404).send({
          error: "City not found in shipping rates",
        });
      }

      await firebase.db.collection("settings").doc("shippingRates").update({
        rates: newRates,
        updatedAt: new Date().toISOString(),
      });

      return {
        success: true,
        message: "City rate deleted successfully",
      };
    } catch (error) {
      fastify.log.error("Failed to delete shipping rate:", error);
      return reply.status(500).send({
        error: "Failed to delete shipping rate",
        message: error.message,
      });
    }
  });
}
