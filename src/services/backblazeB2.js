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
    this.s3Endpoint = null;
    this.config = {
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
      bucketName: process.env.B2_BUCKET_NAME,
      bucketId: process.env.B2_BUCKET_ID,
      downloadUrl: process.env.B2_DOWNLOAD_URL,
      s3Endpoint: process.env.B2_S3_ENDPOINT,
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

      // Get S3 endpoint from config or auth response
      this.s3Endpoint = this.config.s3Endpoint || authResponse?.data?.s3Endpoint || null;

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

  async _getFreshUploadCredentials() {
    if (!this.b2) {
      await this.initialize();
    }

    const uploadResponse = await this.b2.getUploadUrl({
      bucketId: this.bucketId,
    });

    return {
      uploadUrl: uploadResponse.data.uploadUrl,
      authorizationToken: uploadResponse.data.authorizationToken,
    };
  }

  async uploadFile(fileBuffer, fileName, contentType, options = {}) {
    // Always get a fresh upload URL/token for each upload to avoid
    // B2 "auth_token_limit" errors when multiple uploads run concurrently
    const { uploadUrl, authorizationToken } = await this._getFreshUploadCredentials();

    try {
      // Generate unique filename if not provided
      const uniqueFileName = fileName || `${uuidv4()}-${Date.now()}`;

      // Upload file to B2
      const uploadResponse = await this.b2.uploadFile({
        uploadUrl: uploadUrl,
        uploadAuthToken: authorizationToken,
        fileName: uniqueFileName,
        data: fileBuffer,
        mime: contentType,
        ...options,
      });

      const fileId = uploadResponse.data.fileId;
      const fileNameInB2 = uploadResponse.data.fileName;

      // Use S3 endpoint for the URL (more reliable than friendly URL)
      const baseUrl = this.s3Endpoint 
        ? `https://${this.s3Endpoint}`
        : `https://${this.bucketName}.s3.eu-central-003.backblazeb2.com`;
      const publicUrl = `${baseUrl}/${fileNameInB2}`;

      return {
        fileId,
        fileName: fileNameInB2,
        url: publicUrl,
        bucketName: this.bucketName,
        uploadTimestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Failed to upload file to Backblaze B2:", error);

      // If upload fails due to expired auth or token limit, get fresh credentials and retry once
      const b2ErrorCode = error?.response?.data?.code;
      if (
        (error.response && error.response.status === 401) ||
        b2ErrorCode === 'auth_token_limit'
      ) {
        console.log(`Retrying upload after B2 error: ${b2ErrorCode || error.response?.status}`);
        const freshCreds = await this._getFreshUploadCredentials();
        const uniqueFileName = fileName || `${uuidv4()}-${Date.now()}`;

        const retryResponse = await this.b2.uploadFile({
          uploadUrl: freshCreds.uploadUrl,
          uploadAuthToken: freshCreds.authorizationToken,
          fileName: uniqueFileName,
          data: fileBuffer,
          mime: contentType,
          ...options,
        });

        const fileId = retryResponse.data.fileId;
        const fileNameInB2 = retryResponse.data.fileName;

        const baseUrl = this.s3Endpoint 
          ? `https://${this.s3Endpoint}`
          : `https://${this.bucketName}.s3.eu-central-003.backblazeb2.com`;
        const publicUrl = `${baseUrl}/${fileNameInB2}`;

        return {
          fileId,
          fileName: fileNameInB2,
          url: publicUrl,
          bucketName: this.bucketName,
          uploadTimestamp: new Date().toISOString(),
        };
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
    const baseUrl = this.s3Endpoint 
      ? `https://${this.s3Endpoint}`
      : `https://${this.bucketName}.s3.eu-central-003.backblazeb2.com`;
    return `${baseUrl}/${fileName}`;
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
