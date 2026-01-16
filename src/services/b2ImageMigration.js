import firebase from './firebaseAdmin.js';
import backblazeB2 from './backblazeB2.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

/**
 * Migration service to re-upload product images to Backblaze B2
 * and add a new b2ImageCollection field to each product document.
 * 
 * The b2ImageCollection field will contain an array of objects with:
 * - id: unique identifier for the image
 * - url: the Backblaze B2 URL
 * - originalUrl: the original Firebase Storage URL (for reference)
 */
class B2ImageMigration {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 10;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 2000;
    this.statusFile = options.statusFile || 'b2-image-migration-status.json';
    
    this.urlCache = new Map();
    this.stats = {
      totalProducts: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      imagesUploaded: 0
    };
  }

  async initialize() {
    console.log('Initializing B2 Image Migration service...');
    await backblazeB2.initialize();
    console.log('B2 Image Migration service initialized successfully');
  }

  loadStatus() {
    try {
      if (fs.existsSync(this.statusFile)) {
        const data = fs.readFileSync(this.statusFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Could not load migration status:', error.message);
    }
    return {
      completed: [],
      failed: [],
      lastProcessedDoc: null,
      totalProcessed: 0
    };
  }

  saveStatus(status) {
    try {
      fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
    } catch (error) {
      console.error('Failed to save migration status:', error.message);
    }
  }

  isFirebaseStorageUrl(url) {
    return url && (
      url.includes('firebasestorage.googleapis.com') ||
      url.includes('firebaseapp.com') ||
      url.includes('appspot.com')
    );
  }

  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const encodedPath = pathname.includes('/o/')
        ? pathname.split('/o/')[1]
        : pathname.split('/').pop();
      const decodedPath = decodeURIComponent(encodedPath || '');

      const timestamp = Date.now();
      const lastSlashIndex = decodedPath.lastIndexOf('/');
      const baseName = lastSlashIndex >= 0 ? decodedPath.slice(lastSlashIndex + 1) : decodedPath;
      const prefix = lastSlashIndex >= 0 ? decodedPath.slice(0, lastSlashIndex + 1) : '';

      const dotIndex = baseName.lastIndexOf('.');
      const nameWithoutExt = dotIndex >= 0 ? baseName.slice(0, dotIndex) : baseName;
      const extension = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : '';

      const newName = `${nameWithoutExt}-${timestamp}`;
      const fileName = extension ? `${newName}.${extension}` : newName;

      return `products-b2/${prefix}${fileName}`;
    } catch (error) {
      return `products-b2/migrated-file-${Date.now()}`;
    }
  }

  async uploadImageToB2(url, retryCount = 0) {
    // Check cache first
    if (this.urlCache.has(url)) {
      const cached = this.urlCache.get(url);
      if (cached.status === 'success') {
        return cached.result;
      } else if (cached.status === 'failed') {
        throw new Error(cached.error);
      }
    }

    try {
      const fileName = this.extractFileNameFromUrl(url);
      console.log(`  Uploading: ${url.substring(0, 80)}...`);
      
      const result = await backblazeB2.uploadFileFromUrl(url, fileName, null);
      
      this.urlCache.set(url, { status: 'success', result });
      this.stats.imagesUploaded++;
      
      return result;
    } catch (error) {
      if (error?.response?.status === 404) {
        console.warn(`  Image not found (404): ${url.substring(0, 80)}...`);
        this.urlCache.set(url, { status: 'failed', error: 'Image not found (404)' });
        throw error;
      }

      if (retryCount < this.maxRetries) {
        console.log(`  Retry ${retryCount + 1}/${this.maxRetries} for: ${url.substring(0, 50)}...`);
        await this.delay(this.retryDelay * (retryCount + 1));
        return this.uploadImageToB2(url, retryCount + 1);
      }

      this.urlCache.set(url, { status: 'failed', error: error.message });
      throw error;
    }
  }

  async migrateProduct(productId, productData) {
    console.log(`\nMigrating product: ${productId} - "${productData.name || 'Unnamed'}"`);
    
    // Skip if already has b2ImageCollection
    if (productData.b2ImageCollection && productData.b2ImageCollection.length > 0) {
      console.log(`  Skipping: Product already has b2ImageCollection`);
      return { success: true, skipped: true, reason: 'Already has b2ImageCollection' };
    }

    const b2ImageCollection = [];
    const errors = [];

    // Collect all image URLs to migrate
    const imagesToMigrate = [];

    // Main product image
    if (productData.image && this.isFirebaseStorageUrl(productData.image)) {
      imagesToMigrate.push({
        type: 'main',
        url: productData.image,
        originalId: 'main'
      });
    }

    // Image collection
    if (productData.imageCollection && Array.isArray(productData.imageCollection)) {
      productData.imageCollection.forEach((img, index) => {
        const imgUrl = typeof img === 'string' ? img : img?.url;
        const imgId = typeof img === 'object' ? img?.id : `collection-${index}`;
        
        if (imgUrl && this.isFirebaseStorageUrl(imgUrl)) {
          imagesToMigrate.push({
            type: 'collection',
            url: imgUrl,
            originalId: imgId || `collection-${index}`,
            index
          });
        }
      });
    }

    if (imagesToMigrate.length === 0) {
      console.log(`  Skipping: No Firebase Storage URLs found`);
      return { success: true, skipped: true, reason: 'No Firebase Storage URLs found' };
    }

    console.log(`  Found ${imagesToMigrate.length} images to migrate`);

    // Upload each image to B2
    for (const imageInfo of imagesToMigrate) {
      try {
        const b2Result = await this.uploadImageToB2(imageInfo.url);
        
        b2ImageCollection.push({
          id: uuidv4(),
          url: b2Result.url,
          originalUrl: imageInfo.url,
          originalId: imageInfo.originalId,
          type: imageInfo.type,
          fileId: b2Result.fileId,
          fileName: b2Result.fileName,
          uploadedAt: new Date().toISOString()
        });
        
        console.log(`  ✓ Uploaded: ${b2Result.url.substring(0, 60)}...`);
      } catch (error) {
        const errorMsg = error?.response?.status === 404 
          ? 'Image not found (404)' 
          : error.message;
        
        errors.push({
          url: imageInfo.url,
          originalId: imageInfo.originalId,
          type: imageInfo.type,
          error: errorMsg
        });
        
        console.error(`  ✗ Failed: ${imageInfo.url.substring(0, 60)}... - ${errorMsg}`);
      }
    }

    // Update the product document with b2ImageCollection
    if (b2ImageCollection.length > 0) {
      try {
        const updateData = {
          b2ImageCollection: b2ImageCollection,
          b2MigrationMetadata: {
            migratedAt: new Date().toISOString(),
            totalImages: imagesToMigrate.length,
            successfullyMigrated: b2ImageCollection.length,
            failedToMigrate: errors.length,
            errors: errors.length > 0 ? errors : null
          }
        };

        await firebase.db.collection('products').doc(productId).update(updateData);
        console.log(`  ✓ Updated product document with ${b2ImageCollection.length} B2 images`);

        return {
          success: true,
          productId,
          imagesUploaded: b2ImageCollection.length,
          imagesFailed: errors.length,
          b2ImageCollection
        };
      } catch (error) {
        console.error(`  ✗ Failed to update Firestore document: ${error.message}`);
        return {
          success: false,
          productId,
          error: `Failed to update Firestore: ${error.message}`,
          b2ImageCollection
        };
      }
    } else {
      console.log(`  ✗ No images were successfully uploaded`);
      return {
        success: false,
        productId,
        error: 'All image uploads failed',
        errors
      };
    }
  }

  async migrateAllProducts(options = {}) {
    const {
      resume = true,
      dryRun = false,
      maxProducts = null,
      specificIds = null
    } = options;

    console.log('\n========================================');
    console.log('B2 Image Collection Migration');
    console.log('========================================');
    console.log(`Options: ${JSON.stringify({ resume, dryRun, maxProducts, specificIds: specificIds?.length || 'all' })}`);

    const status = resume ? this.loadStatus() : {
      completed: [],
      failed: [],
      lastProcessedDoc: null,
      totalProcessed: 0
    };

    try {
      if (specificIds && specificIds.length > 0) {
        // Migrate specific products
        for (const productId of specificIds) {
          if (status.completed.includes(productId)) {
            console.log(`Skipping ${productId} - already completed`);
            this.stats.skipped++;
            continue;
          }

          const doc = await firebase.db.collection('products').doc(productId).get();
          if (!doc.exists) {
            console.log(`Product ${productId} not found`);
            status.failed.push({ productId, error: 'Document not found', timestamp: new Date().toISOString() });
            this.stats.failed++;
            continue;
          }

          if (dryRun) {
            console.log(`[DRY RUN] Would migrate product: ${productId}`);
            this.stats.processed++;
            continue;
          }

          const result = await this.migrateProduct(productId, doc.data());
          this.stats.processed++;

          if (result.success) {
            if (result.skipped) {
              this.stats.skipped++;
            } else {
              this.stats.successful++;
              status.completed.push(productId);
            }
          } else {
            this.stats.failed++;
            status.failed.push({ productId, error: result.error, timestamp: new Date().toISOString() });
          }

          this.saveStatus(status);
        }
      } else {
        // Migrate all products with pagination
        let startAfter = resume && status.lastProcessedDoc ? status.lastProcessedDoc : null;
        let hasMore = true;

        while (hasMore) {
          let query = firebase.db
            .collection('products')
            .orderBy('__name__')
            .limit(this.batchSize);

          if (startAfter) {
            query = query.startAfter(startAfter);
          }

          const snapshot = await query.get();

          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          for (const doc of snapshot.docs) {
            if (maxProducts && this.stats.processed >= maxProducts) {
              hasMore = false;
              break;
            }

            const productId = doc.id;

            if (status.completed.includes(productId)) {
              console.log(`Skipping ${productId} - already completed`);
              this.stats.skipped++;
              this.stats.processed++;
              continue;
            }

            if (dryRun) {
              console.log(`[DRY RUN] Would migrate product: ${productId}`);
              this.stats.processed++;
              continue;
            }

            const result = await this.migrateProduct(productId, doc.data());
            this.stats.processed++;

            if (result.success) {
              if (result.skipped) {
                this.stats.skipped++;
              } else {
                this.stats.successful++;
                status.completed.push(productId);
              }
            } else {
              this.stats.failed++;
              status.failed.push({ productId, error: result.error, timestamp: new Date().toISOString() });
            }

            status.lastProcessedDoc = productId;
            status.totalProcessed = this.stats.processed;

            // Save progress periodically
            if (this.stats.processed % 5 === 0) {
              this.saveStatus(status);
              this.printProgress();
            }

            // Small delay to avoid rate limiting
            await this.delay(500);
          }

          startAfter = snapshot.docs[snapshot.docs.length - 1];
          
          // Delay between batches
          await this.delay(1000);
        }
      }

      // Final status save
      this.saveStatus(status);

      console.log('\n========================================');
      console.log('Migration Complete');
      console.log('========================================');
      this.printProgress();

      return {
        ...this.stats,
        completed: status.completed,
        failed: status.failed
      };
    } catch (error) {
      console.error('\nMigration failed with error:', error);
      this.saveStatus(status);
      throw error;
    }
  }

  printProgress() {
    console.log('\n--- Progress ---');
    console.log(`Processed: ${this.stats.processed}`);
    console.log(`Successful: ${this.stats.successful}`);
    console.log(`Failed: ${this.stats.failed}`);
    console.log(`Skipped: ${this.stats.skipped}`);
    console.log(`Images Uploaded: ${this.stats.imagesUploaded}`);
    console.log('----------------\n');
  }

  async retryFailed() {
    const status = this.loadStatus();
    
    if (status.failed.length === 0) {
      console.log('No failed migrations to retry');
      return { retried: 0, successful: 0, stillFailed: 0 };
    }

    console.log(`\nRetrying ${status.failed.length} failed migrations...`);

    const failedCopy = [...status.failed];
    let successful = 0;
    let stillFailed = 0;

    for (const failedItem of failedCopy) {
      const { productId } = failedItem;
      
      try {
        const doc = await firebase.db.collection('products').doc(productId).get();
        if (!doc.exists) {
          console.log(`Product ${productId} no longer exists`);
          stillFailed++;
          continue;
        }

        const result = await this.migrateProduct(productId, doc.data());

        if (result.success && !result.skipped) {
          successful++;
          status.failed = status.failed.filter(f => f.productId !== productId);
          status.completed.push(productId);
        } else {
          stillFailed++;
        }
      } catch (error) {
        console.error(`Retry failed for ${productId}: ${error.message}`);
        stillFailed++;
      }

      this.saveStatus(status);
    }

    console.log(`\nRetry complete: ${successful} successful, ${stillFailed} still failed`);
    return { retried: failedCopy.length, successful, stillFailed };
  }

  generateReport() {
    const status = this.loadStatus();
    
    return {
      timestamp: new Date().toISOString(),
      totalProcessed: status.totalProcessed,
      completed: status.completed.length,
      failed: status.failed.length,
      failedItems: status.failed,
      successRate: status.totalProcessed > 0
        ? ((status.completed.length / status.totalProcessed) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  cleanup() {
    if (fs.existsSync(this.statusFile)) {
      fs.unlinkSync(this.statusFile);
      console.log('Migration status file removed');
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default B2ImageMigration;
