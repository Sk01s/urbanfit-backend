import B2 from "backblaze-b2";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();
class BackblazeB2Service {
  constructor() {
    this.b2 = null;
    this.bucketId = null;
    this.bucketName = null;
    this.uploadUrl = null;
    this.uploadAuthorizationToken = null;
    this.downloadUrl = null;
    this.config = {
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
      bucketName: process.env.B2_BUCKET_NAME,
      bucketId: process.env.B2_BUCKET_ID,
      downloadUrl: process.env.B2_DOWNLOAD_URL,
    };
  }

  async initialize() {
    try {
      console.log("config:", this.config);
      this.b2 = new B2({
        applicationKeyId: this.config.applicationKeyId,
        applicationKey: this.config.applicationKey,
      });

      const authResponse = await this.b2.authorize();
      const authorizedDownloadUrl = authResponse?.data?.downloadUrl;

      // Get bucket info if not provided
      if (!this.config.bucketId) {
        const buckets = await this.b2.listBuckets();
        const bucket = buckets.data.buckets.find(
          (b) => b.bucketName === this.config.bucketName
        );
        if (bucket) {
          this.bucketId = bucket.bucketId;
          this.bucketName = bucket.bucketName;
        } else {
          throw new Error(`Bucket ${this.config.bucketName} not found`);
        }
      } else {
        this.bucketId = this.config.bucketId;
        this.bucketName = this.config.bucketName;
      }

      // Get upload URL and authorization token
      const uploadResponse = await this.b2.getUploadUrl({
        bucketId: this.bucketId,
      });

      this.uploadUrl = uploadResponse.data.uploadUrl;
      this.uploadAuthorizationToken = uploadResponse.data.authorizationToken;
      this.downloadUrl =
        this.config.downloadUrl ||
        authorizedDownloadUrl ||
        uploadResponse.data?.downloadUrl ||
        this.b2.downloadUrl;

      console.log("Backblaze B2 service initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Backblaze B2 service:", error);
      throw error;
    }
  }

  async uploadFile(fileBuffer, fileName, contentType, options = {}) {
    try {
      if (!this.uploadUrl || !this.uploadAuthorizationToken) {
        await this.initialize();
      }

      // Generate unique filename if not provided
      const uniqueFileName = fileName || `${uuidv4()}-${Date.now()}`;

      // Upload file to B2
      const uploadResponse = await this.b2.uploadFile({
        uploadUrl: this.uploadUrl,
        uploadAuthToken: this.uploadAuthorizationToken,
        fileName: uniqueFileName,
        data: fileBuffer,
        mime: contentType,
        ...options,
      });

      const fileId = uploadResponse.data.fileId;
      const fileNameInB2 = uploadResponse.data.fileName;

      const baseUrl = this.config.downloadUrl || this.downloadUrl || "https://f002.backblazeb2.com";
      const encodedFileName = encodeURI(fileNameInB2);
      const publicUrl = `${baseUrl}/file/${this.bucketName}/${encodedFileName}`;

      return {
        fileId,
        fileName: fileNameInB2,
        url: publicUrl,
        bucketName: this.bucketName,
        uploadTimestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Failed to upload file to Backblaze B2:", error);

      // If upload fails due to expired token, refresh and retry once
      if (error.response && error.response.status === 401) {
        console.log("Refreshing B2 upload token and retrying...");
        await this.initialize();
        return this.uploadFile(fileBuffer, fileName, contentType, options);
      }

      throw error;
    }
  }

  async uploadFileFromUrl(fileUrl, fileName, contentType) {
    try {
      // Download file from URL
      const response = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 second timeout
      });

      const fileBuffer = Buffer.from(response.data);
      const detectedContentType =
        contentType ||
        response.headers["content-type"] ||
        "application/octet-stream";

      return await this.uploadFile(fileBuffer, fileName, detectedContentType);
    } catch (error) {
      if (error?.response?.status === 404) {
        throw error;
      }
      console.error("Failed to upload file from URL:", error);
      throw error;
    }
  }

  async deleteFile(fileId) {
    try {
      await this.b2.deleteFileVersion({
        fileId: fileId,
      });
      return true;
    } catch (error) {
      console.error("Failed to delete file from Backblaze B2:", error);
      throw error;
    }
  }

  getPublicUrl(fileName) {
    const baseUrl = this.config.downloadUrl || this.downloadUrl || "https://f002.backblazeb2.com";
    return `${baseUrl}/file/${this.bucketName}/${encodeURI(fileName)}`;
  }

  // Refresh upload credentials
  async refreshUploadCredentials() {
    try {
      const uploadResponse = await this.b2.getUploadUrl({
        bucketId: this.bucketId,
      });

      this.uploadUrl = uploadResponse.data.uploadUrl;
      this.uploadAuthorizationToken = uploadResponse.data.authorizationToken;

      console.log("B2 upload credentials refreshed");
    } catch (error) {
      console.error("Failed to refresh B2 upload credentials:", error);
      throw error;
    }
  }
}

export default new BackblazeB2Service();
