import admin from "firebase-admin";

class FirebaseAdmin {
  constructor() {
    if (!admin.apps.length) {
      // Use environment variables for service account
      const serviceAccount = {
        type: process.env.FIREBASE_TYPE || "service_account",
        project_id:
          process.env.FIREBASE_PROJECT_ID ||
          process.env.REACT_APP_FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri:
          process.env.FIREBASE_AUTH_URI ||
          "https://accounts.google.com/o/oauth2/auth",
        token_uri:
          process.env.FIREBASE_TOKEN_URI ||
          "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url:
          process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL ||
          "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      };

      // Validate required fields
      if (!serviceAccount.project_id) {
        console.warn(
          "⚠️  Firebase project_id not found. Using mock service for development.",
        );
        this.initializeMockService();
        return;
      }
      if (!serviceAccount.private_key) {
        console.warn(
          "⚠️  Firebase private_key not found. Using mock service for development.",
        );
        this.initializeMockService();
        return;
      }
      if (!serviceAccount.client_email) {
        console.warn(
          "⚠️  Firebase client_email not found. Using mock service for development.",
        );
        this.initializeMockService();
        return;
      }

      try {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
        });
        console.log("✅ Firebase Admin SDK initialized successfully");
      } catch (error) {
        console.error("❌ Failed to initialize Firebase Admin:", error.message);
        console.warn("⚠️  Using mock service for development");
        this.initializeMockService();
      }
    }

    this.db = admin.firestore();
    this.storage = admin.storage();
    this.auth = admin.auth();
  }

  // Initialize mock service for development/testing
  initializeMockService() {
    console.log("🔄 Initializing Firebase Admin Mock Service for development");

    // Mock Firestore
    this.db = {
      collection: (collectionName) => ({
        doc: (docId) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              image:
                "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/test.jpg",
              name: "Test Product",
              price: 99.99,
            }),
          }),
          update: async (data) => {
            console.log(`📝 Mock update: ${collectionName}/${docId}`, data);
            return { success: true };
          },
        }),
        limit: (limit) => ({
          get: async () => ({
            docs: [
              {
                id: "test1",
                data: () => ({
                  image:
                    "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/test1.jpg",
                  name: "Test Product 1",
                }),
              },
              {
                id: "test2",
                data: () => ({
                  image:
                    "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/test2.jpg",
                  name: "Test Product 2",
                }),
              },
            ],
            size: 2,
          }),
        }),
      }),
    };

    // Mock Storage
    this.storage = {
      bucket: () => ({
        file: (filePath) => ({
          download: async () => [Buffer.from("mock file content")],
          getMetadata: async () => [
            {
              mediaLink:
                "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/" +
                filePath,
            },
          ],
        }),
      }),
    };

    // Mock Auth
    this.auth = {
      verifyIdToken: async (token) => ({ uid: "mock-uid" }),
    };

    console.log("✅ Firebase Admin Mock Service initialized");
  }

  // Firestore Operations
  getDocument(collectionName, docId) {
    return this.db.collection(collectionName).doc(docId).get();
  }

  updateDocument(collectionName, docId, data) {
    return this.db.collection(collectionName).doc(docId).update(data);
  }

  getDocuments(collectionName, limit = 100, startAfter = null) {
    let query = this.db.collection(collectionName).limit(limit);

    if (startAfter) {
      query = query.startAfter(startAfter);
    }

    return query.get();
  }

  // Storage Operations
  async getFileFromStorage(filePath) {
    const bucket = this.storage.bucket();
    const file = bucket.file(filePath);

    const [buffer] = await file.download();
    return buffer;
  }

  async getDownloadURL(filePath) {
    const bucket = this.storage.bucket();
    const file = bucket.file(filePath);

    const [metadata] = await file.getMetadata();
    return metadata.mediaLink;
  }

  // Check if URL is Firebase Storage URL
  isFirebaseStorageUrl(url) {
    return (
      url &&
      (url.includes("firebasestorage.googleapis.com") ||
        url.includes("firebaseapp.com") ||
        url.includes("appspot.com"))
    );
  }

  // Check if URL is Backblaze B2 URL
  isBackblazeB2Url(url) {
    return url && url.includes("backblazeb2.com");
  }

  // Collect storage URLs from nested fields
  collectStorageUrls(data) {
    const storageUrls = [];

    const visit = (value, path) => {
      if (typeof value === "string") {
        if (this.isFirebaseStorageUrl(value)) {
          storageUrls.push({
            path: path.join("."),
            url: value,
            type: "firebase",
          });
        } else if (this.isBackblazeB2Url(value)) {
          storageUrls.push({
            path: path.join("."),
            url: value,
            type: "backblaze",
          });
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, index]));
        return;
      }

      if (value && typeof value === "object") {
        Object.entries(value).forEach(([key, item]) =>
          visit(item, [...path, key]),
        );
      }
    };

    visit(data, []);
    return storageUrls;
  }

  // Get migration status for a document
  async getDocumentMigrationStatus(collectionName, docId) {
    try {
      const doc = await this.db.collection(collectionName).doc(docId).get();
      if (!doc.exists) {
        return { exists: false };
      }

      const data = doc.data();
      const storageUrls = this.collectStorageUrls(data);

      return {
        exists: true,
        documentId: docId,
        collectionName: collectionName,
        storageUrls: storageUrls,
        migrationStatus: data.migrationMetadata || null,
        needsMigration: storageUrls.some((url) => url.type === "firebase"),
        totalFirebaseUrls: storageUrls.filter((url) => url.type === "firebase")
          .length,
        totalBackblazeUrls: storageUrls.filter(
          (url) => url.type === "backblaze",
        ).length,
      };
    } catch (error) {
      console.error(
        `Failed to get migration status for ${collectionName}/${docId}:`,
        error,
      );
      throw error;
    }
  }
}

export default new FirebaseAdmin();
