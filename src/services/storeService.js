/**
 * Firestore-based store service for Vercel serverless environment
 * Replaces in-memory stores with persistent Firestore collections
 */

class StoreService {
  constructor() {
    this.db = null;
  }

  initialize(db) {
    this.db = db;
    console.log("Store service initialized with Firestore");
  }

  // ============================================
  // ADMIN OTP STORE
  // ============================================

  /**
   * Store an OTP for an admin
   */
  async storeAdminOtp(adminId, otp, email, expiresAt) {
    if (!this.db) throw new Error("Store service not initialized");

    await this.db.collection("adminOtps").doc(adminId).set({
      otp,
      email,
      expiresAt,
      createdAt: Date.now(),
    });
  }

  /**
   * Get stored OTP for an admin
   */
  async getAdminOtp(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    const doc = await this.db.collection("adminOtps").doc(adminId).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  /**
   * Delete OTP for an admin
   */
  async deleteAdminOtp(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    await this.db.collection("adminOtps").doc(adminId).delete();
  }

  /**
   * Clean up expired OTPs
   */
  async cleanupExpiredOtps() {
    if (!this.db) throw new Error("Store service not initialized");

    const now = Date.now();
    const snapshot = await this.db
      .collection("adminOtps")
      .where("expiresAt", "<", now)
      .get();

    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return snapshot.size;
  }

  // ============================================
  // ADMIN VERIFICATION STORE
  // ============================================

  /**
   * Store admin verification status
   */
  async storeAdminVerification(adminId, verifiedAt, expiresAt) {
    if (!this.db) throw new Error("Store service not initialized");

    await this.db.collection("adminVerifications").doc(adminId).set({
      verifiedAt,
      expiresAt,
    });
  }

  /**
   * Get admin verification status
   */
  async getAdminVerification(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    const doc = await this.db.collection("adminVerifications").doc(adminId).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  /**
   * Delete admin verification
   */
  async deleteAdminVerification(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    await this.db.collection("adminVerifications").doc(adminId).delete();
  }

  /**
   * Clean up expired verifications
   */
  async cleanupExpiredVerifications() {
    if (!this.db) throw new Error("Store service not initialized");

    const now = Date.now();
    const snapshot = await this.db
      .collection("adminVerifications")
      .where("expiresAt", "<", now)
      .get();

    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return snapshot.size;
  }

  // ============================================
  // ADMIN OTP ATTEMPTS (Rate Limiting)
  // ============================================

  /**
   * Get OTP attempts for an admin today
   */
  async getAdminOtpAttempts(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const docId = `${adminId}_${today}`;

    const doc = await this.db.collection("adminOtpAttempts").doc(docId).get();
    if (!doc.exists) return 0;
    return doc.data().count || 0;
  }

  /**
   * Increment OTP attempts for an admin
   */
  async incrementAdminOtpAttempts(adminId) {
    if (!this.db) throw new Error("Store service not initialized");

    const today = new Date().toISOString().split("T")[0];
    const docId = `${adminId}_${today}`;

    const doc = await this.db.collection("adminOtpAttempts").doc(docId).get();
    const currentCount = doc.exists ? doc.data().count || 0 : 0;

    await this.db.collection("adminOtpAttempts").doc(docId).set({
      count: currentCount + 1,
      date: today,
      updatedAt: Date.now(),
    });

    return currentCount + 1;
  }

  /**
   * Clean up old OTP attempts (older than today)
   */
  async cleanupOldOtpAttempts() {
    if (!this.db) throw new Error("Store service not initialized");

    const today = new Date().toISOString().split("T")[0];
    const snapshot = await this.db
      .collection("adminOtpAttempts")
      .where("date", "<", today)
      .get();

    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return snapshot.size;
  }

  // ============================================
  // WISHLIST EMAIL QUEUE
  // ============================================

  /**
   * Add item to wishlist email queue
   */
  async addToWishlistQueue(userId, productId, data) {
    if (!this.db) throw new Error("Store service not initialized");

    const docId = `${userId}_${productId}`;
    await this.db.collection("wishlistEmailQueue").doc(docId).set({
      userId,
      productId,
      userEmail: data.userEmail,
      userName: data.userName,
      product: data.product,
      addedAt: data.addedAt || Date.now(),
      sendAt: data.sendAt,
      createdAt: Date.now(),
    });
  }

  /**
   * Remove item from wishlist email queue
   */
  async removeFromWishlistQueue(userId, productId) {
    if (!this.db) throw new Error("Store service not initialized");

    const docId = `${userId}_${productId}`;
    await this.db.collection("wishlistEmailQueue").doc(docId).delete();
  }

  /**
   * Check if item exists in wishlist queue
   */
  async isInWishlistQueue(userId, productId) {
    if (!this.db) throw new Error("Store service not initialized");

    const docId = `${userId}_${productId}`;
    const doc = await this.db.collection("wishlistEmailQueue").doc(docId).get();
    return doc.exists;
  }

  /**
   * Get pending wishlist emails ready to be sent
   */
  async getPendingWishlistEmails() {
    if (!this.db) throw new Error("Store service not initialized");

    const now = Date.now();
    const snapshot = await this.db
      .collection("wishlistEmailQueue")
      .where("sendAt", "<=", now)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  /**
   * Delete processed wishlist email from queue
   */
  async deleteWishlistQueueItem(docId) {
    if (!this.db) throw new Error("Store service not initialized");

    await this.db.collection("wishlistEmailQueue").doc(docId).delete();
  }
}

export default new StoreService();
