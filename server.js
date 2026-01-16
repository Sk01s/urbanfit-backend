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
import cron from "node-cron";

// Dynamically import services after dotenv is loaded
const firebase = (await import("./src/services/firebaseAdmin.js")).default;
const backblazeB2 = (await import("./src/services/backblazeB2.js")).default;
const FirebaseToB2Migration = (await import("./src/services/migration.js"))
  .default;
const emailService = (await import("./src/services/emailService.js")).default;

// Initialize email service
emailService.initialize();

const fastify = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  },
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

// Migration status endpoint
// fastify.get(
//   "/api/migration/status/:collection/:documentId",
//   async (request, reply) => {
//     try {
//       const { collection, documentId } = request.params;

//       const status = await firebase.getDocumentMigrationStatus(
//         collection,
//         documentId,
//       );

//       return {
//         success: true,
//         data: status,
//       };
//     } catch (error) {
//       fastify.log.error("Failed to get migration status:", error);
//       return reply.status(500).send({
//         error: "Failed to get migration status",
//         message: error.message,
//       });
//     }
//   },
// );

// // Bulk migration status endpoint
// fastify.post("/api/migration/status/bulk", async (request, reply) => {
//   try {
//     const { collection, documentIds } = request.body;

//     if (!collection || !Array.isArray(documentIds)) {
//       return reply.status(400).send({
//         error: "Invalid request. Provide collection and documentIds array.",
//       });
//     }

//     const results = await Promise.allSettled(
//       documentIds.map((docId) =>
//         firebase.getDocumentMigrationStatus(collection, docId),
//       ),
//     );

//     const statuses = results.map((result, index) => ({
//       documentId: documentIds[index],
//       status: result.status === "fulfilled" ? result.value : null,
//       error: result.status === "rejected" ? result.reason.message : null,
//     }));

//     return {
//       success: true,
//       data: statuses,
//     };
//   } catch (error) {
//     fastify.log.error("Failed to get bulk migration status:", error);
//     return reply.status(500).send({
//       error: "Failed to get bulk migration status",
//       message: error.message,
//     });
//   }
// });

// // Start migration endpoint
// fastify.post("/api/migration/start", async (request, reply) => {
//   try {
//     const { collection, options = {} } = request.body;

//     if (!collection) {
//       return reply.status(400).send({
//         error: "Collection name is required",
//       });
//     }

//     // Initialize migration service
//     const migration = new FirebaseToB2Migration();
//     await migration.initialize();

//     // Start migration in background
//     const migrationPromise = migration.migrateCollection(collection, options);

//     // Return immediately with job ID
//     const jobId = `migration-${Date.now()}`;

//     // Store migration promise for status checking (in production, use a proper job queue)
//     global.migrationJobs = global.migrationJobs || {};
//     global.migrationJobs[jobId] = migrationPromise;

//     return {
//       success: true,
//       jobId: jobId,
//       message: "Migration started in background",
//       collection: collection,
//       options: options,
//     };
//   } catch (error) {
//     fastify.log.error("Failed to start migration:", error);
//     return reply.status(500).send({
//       error: "Failed to start migration",
//       message: error.message,
//     });
//   }
// });

// // Migration job status endpoint
// fastify.get("/api/migration/status/:jobId", async (request, reply) => {
//   try {
//     const { jobId } = request.params;

//     if (!global.migrationJobs || !global.migrationJobs[jobId]) {
//       return reply.status(404).send({
//         error: "Migration job not found",
//       });
//     }

//     const migrationPromise = global.migrationJobs[jobId];

//     // Check if migration is complete
//     if (migrationPromise.isFulfilled) {
//       return {
//         success: true,
//         jobId: jobId,
//         status: "completed",
//         result: await migrationPromise,
//       };
//     } else if (migrationPromise.isRejected) {
//       return {
//         success: false,
//         jobId: jobId,
//         status: "failed",
//         error: migrationPromise.reason,
//       };
//     } else {
//       return {
//         success: true,
//         jobId: jobId,
//         status: "running",
//       };
//     }
//   } catch (error) {
//     fastify.log.error("Failed to get migration job status:", error);
//     return reply.status(500).send({
//       error: "Failed to get migration job status",
//       message: error.message,
//     });
//   }
// });

// // Retry failed migrations endpoint
// fastify.post("/api/migration/retry", async (request, reply) => {
//   try {
//     const { collection } = request.body;

//     if (!collection) {
//       return reply.status(400).send({
//         error: "Collection name is required",
//       });
//     }

//     const migration = new FirebaseToB2Migration();
//     await migration.initialize();

//     const result = await migration.retryFailedMigrations(collection);

//     return {
//       success: true,
//       data: result,
//     };
//   } catch (error) {
//     fastify.log.error("Failed to retry failed migrations:", error);
//     return reply.status(500).send({
//       error: "Failed to retry failed migrations",
//       message: error.message,
//     });
//   }
// });

// // Generate migration report endpoint
// fastify.get("/api/migration/report", async (request, reply) => {
//   try {
//     const migration = new FirebaseToB2Migration();
//     const report = migration.generateReport();

//     return {
//       success: true,
//       data: report,
//     };
//   } catch (error) {
//     fastify.log.error("Failed to generate migration report:", error);
//     return reply.status(500).send({
//       error: "Failed to generate migration report",
//       message: error.message,
//     });
//   }
// });

// // Statistics endpoint
// fastify.get("/api/migration/stats", async (request, reply) => {
//   try {
//     const { collection } = request.query;

//     if (!collection) {
//       return reply.status(400).send({
//         error: "Collection parameter is required",
//       });
//     }

//     // Get total documents in collection
//     const totalSnapshot = await firebase.db.collection(collection).get();
//     const totalDocuments = totalSnapshot.size;

//     // Sample documents to estimate migration needs
//     const sampleSize = Math.min(100, totalDocuments);
//     let needsMigration = 0;
//     let alreadyMigrated = 0;

//     if (sampleSize > 0) {
//       const sampleSnapshot = await firebase.db
//         .collection(collection)
//         .limit(sampleSize)
//         .get();

//       for (const doc of sampleSnapshot.docs) {
//         const status = await firebase.getDocumentMigrationStatus(
//           collection,
//           doc.id,
//         );
//         if (status.needsMigration) {
//           needsMigration++;
//         } else if (status.totalBackblazeUrls > 0) {
//           alreadyMigrated++;
//         }
//       }
//     }

//     const estimatedNeedsMigration =
//       totalDocuments * (needsMigration / sampleSize);
//     const estimatedAlreadyMigrated =
//       totalDocuments * (alreadyMigrated / sampleSize);

//     return {
//       success: true,
//       data: {
//         collection: collection,
//         totalDocuments: totalDocuments,
//         sampledDocuments: sampleSize,
//         needsMigration: Math.round(estimatedNeedsMigration),
//         alreadyMigrated: Math.round(estimatedAlreadyMigrated),
//         migrationPercentage:
//           totalDocuments > 0
//             ? Math.round((estimatedAlreadyMigrated / totalDocuments) * 100)
//             : 0,
//       },
//     };
//   } catch (error) {
//     fastify.log.error("Failed to get migration statistics:", error);
//     return reply.status(500).send({
//       error: "Failed to get migration statistics",
//       message: error.message,
//     });
//   }
// });

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
      product,
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
// ADMIN OTP ENDPOINTS
// ============================================

// In-memory store for OTPs (in production, use Redis or database)
const adminOtpStore = new Map();
const adminVerificationStore = new Map();
const adminOtpAttempts = new Map();

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
    const today = new Date().toDateString();
    const attemptKey = `${adminId}-${today}`;
    const attempts = adminOtpAttempts.get(attemptKey) || 0;

    if (attempts >= 5) {
      return reply.status(429).send({
        error: "Daily OTP limit exceeded. Please try again tomorrow.",
      });
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = Date.now() + 20 * 60 * 1000; // 20 minutes

    // Store OTP
    adminOtpStore.set(adminId, {
      otp,
      expiresAt,
      email: adminEmail,
    });

    // Increment attempts
    adminOtpAttempts.set(attemptKey, attempts + 1);

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

    const storedOtp = adminOtpStore.get(adminId);

    if (!storedOtp) {
      return reply.status(400).send({
        error: "No OTP found. Please request a new one.",
        code: "OTP_NOT_FOUND",
      });
    }

    if (Date.now() > storedOtp.expiresAt) {
      adminOtpStore.delete(adminId);
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
    adminVerificationStore.set(adminId, {
      verifiedAt: Date.now(),
      expiresAt: verificationExpiry,
    });

    // Clear the OTP
    adminOtpStore.delete(adminId);

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

      const verification = adminVerificationStore.get(adminId);

      if (!verification) {
        return {
          success: true,
          verified: false,
          message: "Admin not verified",
        };
      }

      if (Date.now() > verification.expiresAt) {
        adminVerificationStore.delete(adminId);
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
  },
);

// ============================================
// WISHLIST EMAIL SCHEDULER ENDPOINTS
// ============================================

// Store for pending wishlist emails
const wishlistEmailQueue = new Map();

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

    // Store in queue
    const queueKey = `${userId}-${product.id}`;
    wishlistEmailQueue.set(queueKey, {
      userId,
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
      const queueKey = `${userId}-${productId}`;

      if (wishlistEmailQueue.has(queueKey)) {
        wishlistEmailQueue.delete(queueKey);
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
  },
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

// Cron job to process wishlist email queue (runs every hour)
cron.schedule("0 * * * *", async () => {
  console.log("Processing wishlist email queue...");
  const now = Date.now();
  let sent = 0;

  for (const [key, item] of wishlistEmailQueue.entries()) {
    if (now >= item.sendAt) {
      try {
        await emailService.sendWishlistReminder(
          item.userEmail,
          item.userName,
          item.product,
        );
        wishlistEmailQueue.delete(key);
        sent++;
        console.log(
          `Sent wishlist reminder to ${item.userEmail} for product ${item.product.name}`,
        );
      } catch (error) {
        console.error(`Failed to send wishlist reminder for ${key}:`, error);
      }
    }
  }

  console.log(`Wishlist email queue processed. Sent ${sent} emails.`);
});

// Clean up expired OTP attempts daily
cron.schedule("0 0 * * *", () => {
  console.log("Cleaning up expired OTP attempts...");
  const today = new Date().toDateString();

  for (const key of adminOtpAttempts.keys()) {
    if (!key.endsWith(today)) {
      adminOtpAttempts.delete(key);
    }
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

// Start server
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

export default fastify;
