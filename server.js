import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables BEFORE importing other modules
dotenv.config({ path: path.join(__dirname, ".env") });

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";

// Dynamically import services after dotenv is loaded
const firebase = (await import("./src/services/firebaseAdmin.js")).default;
const backblazeB2 = (await import("./src/services/backblazeB2.js")).default;
const emailService = (await import("./src/services/emailService.js")).default;
const storeService = (await import("./src/services/storeService.js")).default;

// Initialize services
emailService.initialize();
storeService.initialize(firebase.db);

const fastify = Fastify({
  logger: true,
});

// Register plugins
await fastify.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

await fastify.register(cors, {
  origin: true, // Allow all origins in development
  credentials: true,
});

fastify.get("/", (request, reply) => {
  return { hello: "world" };
});

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Image upload endpoint
fastify.post("/api/upload", async (request, reply) => {
  try {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const { filename, mimetype, file } = data;
    const buffer = await file.toBuffer();

    // Determine upload service based on configuration
    const useBackblazeB2 =
      process.env.USE_BACKBLAZE_B2_FOR_NEW_UPLOADS === "true";

    let uploadResult;

    if (useBackblazeB2) {
      // Upload to Backblaze B2
      uploadResult = await backblazeB2.uploadFile(buffer, filename, mimetype);
    } else {
      // Upload to Firebase Storage
      const fileRef = firebase.storage
        .ref("uploads")
        .child(`${Date.now()}-${filename}`);
      const snapshot = await fileRef.put(buffer, { contentType: mimetype });
      const url = await snapshot.ref.getDownloadURL();

      uploadResult = {
        url: url,
        fileName: filename,
        service: "firebase",
      };
    }

    return {
      success: true,
      url: uploadResult.url,
      fileName: uploadResult.fileName,
      service: useBackblazeB2 ? "backblaze" : "firebase",
      uploadedAt: new Date().toISOString(),
    };
  } catch (error) {
    fastify.log.error("Upload failed:", error);
    return reply.status(500).send({
      error: "Upload failed",
      message: error.message,
    });
  }
});

// ============================================
// EMAIL ENDPOINTS
// ============================================

// Send order confirmation emails (customer + admin)
fastify.post("/api/email/order-confirmation", async (request, reply) => {
  try {
    const { order } = request.body;

    if (!order || !order.id) {
      return reply.status(400).send({
        error: "Order data is required",
      });
    }

    // Send emails in parallel
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

// ============================================
// ADMIN OTP ENDPOINTS (Using Firestore)
// ============================================

// Generate 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send admin OTP
fastify.post("/api/admin/send-otp", async (request, reply) => {
  try {
    const { adminId, adminEmail, adminName } = request.body;

    if (!adminId || !adminEmail) {
      return reply.status(400).send({
        error: "Admin ID and email are required",
      });
    }

    // Check daily OTP attempts limit (5 per day)
    const attempts = await storeService.getAdminOtpAttempts(adminId);

    if (attempts >= 5) {
      return reply.status(429).send({
        error: "Daily OTP limit exceeded. Please try again tomorrow.",
      });
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = Date.now() + 20 * 60 * 1000; // 20 minutes

    // Store OTP in Firestore
    await storeService.storeAdminOtp(adminId, otp, adminEmail, expiresAt);

    // Increment attempts
    await storeService.incrementAdminOtpAttempts(adminId);

    // Send OTP email
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
      expiresIn: 20 * 60, // seconds
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

    // OTP is valid - store verification
    const verificationExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000; // 2 days
    await storeService.storeAdminVerification(
      adminId,
      Date.now(),
      verificationExpiry
    );

    // Clear the OTP
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

// ============================================
// WISHLIST EMAIL SCHEDULER ENDPOINTS (Using Firestore)
// ============================================

// Get settings from Firestore
async function getWishlistEmailSettings() {
  try {
    const doc = await firebase.db
      .collection("settings")
      .doc("wishlistEmail")
      .get();
    if (doc.exists) {
      return doc.data();
    }
    // Default settings: 12 hours delay
    return { delayHours: 12, enabled: true };
  } catch (error) {
    console.error("Failed to get wishlist email settings:", error);
    return { delayHours: 12, enabled: true };
  }
}

// Schedule wishlist reminder email
fastify.post("/api/wishlist/schedule-reminder", async (request, reply) => {
  try {
    const { userId, userEmail, userName, product, addedAt } = request.body;

    if (!userId || !userEmail || !product) {
      return reply.status(400).send({
        error: "User ID, email, and product data are required",
      });
    }

    const settings = await getWishlistEmailSettings();

    if (!settings.enabled) {
      return {
        success: true,
        message: "Wishlist emails are currently disabled",
        scheduled: false,
      };
    }

    const sendAt =
      (addedAt || Date.now()) + settings.delayHours * 60 * 60 * 1000;

    // Store in Firestore queue
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

// Cancel scheduled wishlist reminder (when item is removed)
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

// Get/Update wishlist email settings (admin only)
fastify.get("/api/admin/settings/wishlist-email", async (request, reply) => {
  try {
    const settings = await getWishlistEmailSettings();
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

// ============================================
// VERCEL CRON ENDPOINTS
// ============================================

// Verify cron request is from Vercel
function verifyCronRequest(request) {
  const authHeader = request.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, verify the request
  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }

  // In development or if no secret is set, allow all requests
  return true;
}

// Process wishlist email queue (called by Vercel Cron every hour)
fastify.get("/api/cron/process-wishlist-emails", async (request, reply) => {
  // Verify cron request
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

// Cleanup expired OTPs and old attempts (called by Vercel Cron daily)
fastify.get("/api/cron/cleanup-otp", async (request, reply) => {
  // Verify cron request
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

// ============================================
// SHIPPING RATES ENDPOINTS
// ============================================

// Default shipping rates for common Lebanese cities
const defaultShippingRates = [
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

// Get all shipping rates
fastify.get("/api/shipping/rates", async (request, reply) => {
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

    // Return defaults if no settings exist
    return {
      success: true,
      data: {
        rates: defaultShippingRates,
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

// Get shipping rate for a specific city
fastify.get("/api/shipping/rate/:city", async (request, reply) => {
  try {
    const { city } = request.params;
    const doc = await firebase.db
      .collection("settings")
      .doc("shippingRates")
      .get();

    let rates = defaultShippingRates;
    let defaultRate = 5;

    if (doc.exists) {
      const data = doc.data();
      rates = data.rates || defaultShippingRates;
      defaultRate = data.defaultRate || 5;
    }

    // Find the rate for the city (case-insensitive)
    const cityLower = city.toLowerCase().trim();
    const cityRate = rates.find(
      (r) => r.city.toLowerCase().trim() === cityLower
    );

    return {
      success: true,
      city: city,
      rate: cityRate ? cityRate.rate : defaultRate,
      isDefault: !cityRate,
    };
  } catch (error) {
    fastify.log.error("Failed to get shipping rate:", error);
    return reply.status(500).send({
      error: "Failed to get shipping rate",
      message: error.message,
    });
  }
});

// Update all shipping rates (admin only)
fastify.put("/api/admin/shipping/rates", async (request, reply) => {
  try {
    const { rates, defaultRate, enabled } = request.body;

    if (!Array.isArray(rates)) {
      return reply.status(400).send({
        error: "Rates must be an array",
      });
    }

    // Validate rates format
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
    let currentRates = defaultShippingRates;
    let settings = { defaultRate: 5, enabled: true };

    if (doc.exists) {
      const data = doc.data();
      currentRates = data.rates || defaultShippingRates;
      settings = {
        defaultRate: data.defaultRate || 5,
        enabled: data.enabled !== false,
      };
    }

    // Check if city already exists (case-insensitive)
    const existingIndex = currentRates.findIndex(
      (r) => r.city.toLowerCase().trim() === city.toLowerCase().trim()
    );

    if (existingIndex >= 0) {
      // Update existing rate
      currentRates[existingIndex].rate = rate;
    } else {
      // Add new rate
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

    // Find and remove the city (case-insensitive)
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

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({
    error: "Internal Server Error",
    message: error.message,
  });
});

// Check if running in Vercel serverless environment
const isVercel = process.env.VERCEL === "1";

if (!isVercel) {
  // Start server normally for local development
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

  // Graceful shutdown
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

// Export for Vercel serverless
export default async function handler(req, res) {
  await fastify.ready();
  fastify.server.emit("request", req, res);
}
