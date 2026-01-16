import firebase from './firebaseAdmin.js';
import backblazeB2 from './backblazeB2.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import MigrationMonitor from './migrationMonitor.js';
import { RetryManager, CircuitBreaker } from './migrationMonitor.js';

class FirebaseToB2Migration {
  constructor(options = {}) {
    this.migrationLog = [];
    this.failedMigrations = [];
    this.successfulMigrations = [];
    this.batchSize = options.batchSize || 10;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 2000;
    this.migrationStatusFile = options.migrationStatusFile || 'migration-status.json';
    
    // Initialize monitoring and retry components
    this.monitor = new MigrationMonitor();
    this.retryManager = new RetryManager({
      maxRetries: this.maxRetries,
      baseDelay: this.retryDelay,
      monitor: this.monitor
    });
    
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000
    });

    this.urlCache = new Map();
  }

  // Initialize services
  async initialize() {
    console.log('Initializing migration services...');
    this.monitor.start();
    
    try {
      await this.circuitBreaker.execute(async () => {
        await backblazeB2.initialize();
      });
      console.log('Services initialized successfully');
    } catch (error) {
      this.monitor.logError(error, { operation: 'initialize_services' });
      throw error;
    }
  }

  // Load existing migration status
  loadMigrationStatus() {
    try {
      if (fs.existsSync(this.migrationStatusFile)) {
        const statusData = fs.readFileSync(this.migrationStatusFile, 'utf8');
        return JSON.parse(statusData);
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

  // Save migration status
  saveMigrationStatus(status) {
    try {
      fs.writeFileSync(this.migrationStatusFile, JSON.stringify(status, null, 2));
    } catch (error) {
      console.error('Failed to save migration status:', error.message);
    }
  }

  // Extract Firebase Storage URLs from nested fields
  extractStorageUrls(documentData) {
    const urls = [];

    const visit = (value, path) => {
      if (typeof value === 'string' && this.isFirebaseStorageUrl(value)) {
        urls.push({ path, url: value });
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, index]));
        return;
      }

      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
      }
    };

    visit(documentData, []);
    return urls;
  }

  // Set a nested value using a path
  setValueAtPath(target, path, value) {
    if (!path.length) {
      return;
    }

    let cursor = target;
    for (let index = 0; index < path.length - 1; index += 1) {
      cursor = cursor[path[index]];
      if (cursor === undefined || cursor === null) {
        return;
      }
    }

    cursor[path[path.length - 1]] = value;
  }

  // Check if URL is Firebase Storage URL
  isFirebaseStorageUrl(url) {
    return url && (
      url.includes('firebasestorage.googleapis.com') ||
      url.includes('firebaseapp.com') ||
      url.includes('appspot.com')
    );
  }

  // Check if error is a not found response
  isNotFoundError(error) {
    return error?.response?.status === 404 ||
      (typeof error?.message === 'string' && error.message.includes('status code 404'));
  }

  // Migrate a single document with enhanced error handling
  async migrateDocument(collectionName, docId, documentData, retryCount = 0) {
    try {
      console.log(`Migrating document ${docId} from collection ${collectionName}`);
      this.monitor.updateMetrics({ 
        totalProcessed: this.monitor.metrics.totalProcessed + 1,
        currentBatch: this.monitor.metrics.currentBatch + 1
      });
      
      const storageUrls = this.extractStorageUrls(documentData);
      
      if (storageUrls.length === 0) {
        console.log(`No Firebase Storage URLs found in document ${docId}`);
        this.monitor.updateMetrics({ skipped: this.monitor.metrics.skipped + 1 });
        return { success: true, skipped: true, reason: 'No Firebase Storage URLs found' };
      }

      const updatedData = { ...documentData };
      const migrationResults = [];
      let failedUrls = 0;

      // Process each storage URL with retry logic
      for (const { path, url } of storageUrls) {
        try {
          console.log(`Migrating URL: ${url}`);
          
          const cachedResult = this.urlCache.get(url);
          if (cachedResult) {
            if (cachedResult.status === 'missing') {
              failedUrls += 1;
              migrationResults.push({
                originalUrl: url,
                newUrl: null,
                fileId: null,
                path: path.join('.'),
                status: 'missing'
              });
              continue;
            }

            migrationResults.push({
              originalUrl: url,
              newUrl: cachedResult.url,
              fileId: cachedResult.fileId,
              path: path.join('.'),
              status: 'migrated'
            });

            this.setValueAtPath(updatedData, path, cachedResult.url);
            continue;
          }

          // Use retry manager for individual URL migration
          const b2Result = await this.retryManager.execute(async (attempt) => {
            const fileName = this.extractFileNameFromUrl(url);
            
            return await this.circuitBreaker.execute(async () => {
              return await backblazeB2.uploadFileFromUrl(
                url,
                fileName,
                null // Let B2 detect content type
              );
            }, (error) => !this.isNotFoundError(error));
          }, { documentId: docId, collectionName: collectionName, url: url });

          this.urlCache.set(url, { status: 'migrated', url: b2Result.url, fileId: b2Result.fileId });

          migrationResults.push({
            originalUrl: url,
            newUrl: b2Result.url,
            fileId: b2Result.fileId,
            path: path.join('.'),
            status: 'migrated'
          });

          // Update the data structure
          this.setValueAtPath(updatedData, path, b2Result.url);

          console.log(`Successfully migrated ${url} to ${b2Result.url}`);
          this.monitor.logSuccess('url_migrated', { 
            documentId: docId, 
            collectionName: collectionName, 
            originalUrl: url, 
            newUrl: b2Result.url 
          });

        } catch (error) {
          if (this.isNotFoundError(error)) {
            failedUrls += 1;
            this.urlCache.set(url, { status: 'missing' });
            console.warn(`Skipping missing file (404): ${url}`);
            this.monitor.logError(error, { 
              documentId: docId, 
              collectionName: collectionName, 
              url: url,
              operation: 'url_missing' 
            });
            migrationResults.push({
              originalUrl: url,
              newUrl: null,
              fileId: null,
              path: path.join('.'),
              status: 'missing'
            });
            continue;
          }

          console.error(`Failed to migrate URL ${url}:`, error.message);
          this.monitor.logError(error, { 
            documentId: docId, 
            collectionName: collectionName, 
            url: url,
            operation: 'url_migration' 
          });
          throw new Error(`Failed to migrate ${url}: ${error.message}`);
        }
      }

      // Add migration metadata
      updatedData.migrationMetadata = {
        migratedAt: new Date().toISOString(),
        originalUrls: storageUrls.map(item => item.url),
        migrationResults: migrationResults,
        migrationVersion: '1.0.0',
        migrationStats: {
          urlsMigrated: migrationResults.filter((result) => result.status === 'migrated').length,
          urlsMissing: failedUrls,
          migrationTime: Date.now() - this.monitor.metrics.startTime
        }
      };

      // Update the document in Firestore with retry logic
      await this.retryManager.execute(async (attempt) => {
        await firebase.db.collection(collectionName).doc(docId).update(updatedData);
      }, { documentId: docId, collectionName: collectionName, operation: 'document_update' });

      console.log(`Successfully updated document ${docId}`);
      const migratedCount = migrationResults.filter((result) => result.status === 'migrated').length;
      this.monitor.logSuccess('document_migrated', { 
        documentId: docId, 
        collectionName: collectionName,
        urlsMigrated: migratedCount
      });
      
      return {
        success: true,
        documentId: docId,
        collectionName: collectionName,
        migrationResults: migrationResults,
        urlsMigrated: migrationResults.filter((result) => result.status === 'migrated').length
      };

    } catch (error) {
      console.error(`Failed to migrate document ${docId}:`, error.message);
      this.monitor.logError(error, { 
        documentId: docId, 
        collectionName: collectionName,
        operation: 'document_migration',
        retryCount: retryCount
      });
      
      this.monitor.updateMetrics({ failed: this.monitor.metrics.failed + 1 });

      return {
        success: false,
        documentId: docId,
        collectionName: collectionName,
        error: error.message,
        retryCount: retryCount
      };
    }
  }

  // Extract filename from Firebase Storage URL
  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const encodedPath = pathname.includes('/o/')
        ? pathname.split('/o/')[1]
        : pathname.split('/').pop();
      const decodedPath = decodeURIComponent(encodedPath || "");

      const timestamp = Date.now();
      const lastSlashIndex = decodedPath.lastIndexOf('/');
      const baseName = lastSlashIndex >= 0 ? decodedPath.slice(lastSlashIndex + 1) : decodedPath;
      const prefix = lastSlashIndex >= 0 ? decodedPath.slice(0, lastSlashIndex + 1) : '';

      const dotIndex = baseName.lastIndexOf('.');
      const nameWithoutExt = dotIndex >= 0 ? baseName.slice(0, dotIndex) : baseName;
      const extension = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : '';

      const newName = `${nameWithoutExt}-${timestamp}`;
      const fileName = extension ? `${newName}.${extension}` : newName;

      return `${prefix}${fileName}`;
    } catch (error) {
      return `migrated-file-${Date.now()}`;
    }
  }

  // Get documents from a collection with pagination
  async getDocumentsBatch(collectionName, startAfter = null, limit = 10) {
    try {
      let query = firebase.db
        .collection(collectionName)
        .orderBy("__name__")
        .limit(limit);
      
      if (startAfter) {
        query = query.startAfter(startAfter);
      }

      const snapshot = await query.get();
      const documents = [];
      
      snapshot.forEach(doc => {
        documents.push({
          id: doc.id,
          data: doc.data()
        });
      });

      return {
        documents,
        lastDoc: snapshot.docs[snapshot.docs.length - 1],
        totalDocs: snapshot.size
      };
    } catch (error) {
      console.error(`Failed to fetch documents from ${collectionName}:`, error);
      throw error;
    }
  }

  // Main migration function with enhanced monitoring
  async migrateCollection(collectionName, options = {}) {
    const {
      resume = true,
      dryRun = false,
      maxDocuments = null,
      specificIds = null
    } = options;

    console.log(`Starting migration for collection: ${collectionName}`);
    if (options.resetCircuitBreaker !== false) {
      this.circuitBreaker.reset();
    }
    this.monitor.start();
    
    const migrationStatus = this.loadMigrationStatus();
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let lastProcessedDoc = null;

    try {
      if (specificIds && specificIds.length > 0) {
        // Migrate specific documents
        for (const docId of specificIds) {
          const doc = await firebase.db.collection(collectionName).doc(docId).get();
          if (doc.exists) {
            const result = await this.migrateDocument(collectionName, docId, doc.data());
            
            if (result.success) {
              if (result.skipped) {
                skippedCount++;
              } else {
                successCount++;
                migrationStatus.completed.push(docId);
              }
            } else {
              failedCount++;
              migrationStatus.failed.push({
                documentId: docId,
                error: result.error,
                timestamp: new Date().toISOString()
              });
            }
          }
          processedCount++;
        }
      } else {
        // Batch migration with circuit breaker protection
        let startAfter = resume && migrationStatus.lastProcessedDoc ? migrationStatus.lastProcessedDoc : null;
        let hasMore = true;
        let consecutiveFailures = 0;

        while (hasMore) {
          try {
            const batch = await this.circuitBreaker.execute(async () => {
              return await this.getDocumentsBatch(collectionName, startAfter, this.batchSize);
            });
            
            if (batch.documents.length === 0) {
              hasMore = false;
              break;
            }

            // Reset consecutive failures on successful batch fetch
            consecutiveFailures = 0;

            for (const doc of batch.documents) {
              if (maxDocuments && processedCount >= maxDocuments) {
                hasMore = false;
                break;
              }

              if (dryRun) {
                console.log(`[DRY RUN] Would migrate document: ${doc.id}`);
                const storageUrls = this.extractStorageUrls(doc.data);
                if (storageUrls.length > 0) {
                  console.log(`[DRY RUN] Found ${storageUrls.length} storage URLs to migrate`);
                }
                processedCount++;
                continue;
              }

              const result = await this.migrateDocument(collectionName, doc.id, doc.data);
              
              if (result.success) {
                if (result.skipped) {
                  skippedCount++;
                } else {
                  successCount++;
                  migrationStatus.completed.push(doc.id);
                }
                consecutiveFailures = 0; // Reset on success
              } else {
                failedCount++;
                consecutiveFailures++;
                migrationStatus.failed.push({
                  documentId: doc.id,
                  error: result.error,
                  timestamp: new Date().toISOString()
                });

                // Stop if too many consecutive failures
                if (consecutiveFailures >= 5) {
                  console.error(`Too many consecutive failures (${consecutiveFailures}), stopping migration`);
                  hasMore = false;
                  break;
                }
              }

              processedCount++;
              lastProcessedDoc = doc.id;
              
              // Save progress every 10 documents
              if (processedCount % 10 === 0) {
                migrationStatus.lastProcessedDoc = lastProcessedDoc;
                migrationStatus.totalProcessed = processedCount;
                this.saveMigrationStatus(migrationStatus);
                this.monitor.updateMetrics({
                  totalProcessed: processedCount,
                  successful: successCount,
                  failed: failedCount,
                  skipped: skippedCount
                });
                console.log(`Progress: ${processedCount} documents processed (${successCount} successful, ${failedCount} failed, ${skippedCount} skipped)`);
                console.log('Circuit breaker state:', this.circuitBreaker.getState());
              }
            }

            startAfter = batch.lastDoc;
            
            // Small delay between batches to avoid rate limiting
            await this.delay(1000);
            
          } catch (error) {
            console.error('Batch processing failed:', error.message);
            this.monitor.logError(error, { 
              collectionName: collectionName, 
              operation: 'batch_processing',
              consecutiveFailures: consecutiveFailures
            });

            if (error.message === 'Circuit breaker is OPEN') {
              const circuitState = this.circuitBreaker.getState();
              if (circuitState.nextAttempt) {
                const waitMs = Math.max(
                  0,
                  new Date(circuitState.nextAttempt).getTime() - Date.now()
                );
                console.log(`Circuit breaker open. Waiting ${waitMs}ms before retrying batch.`);
                await this.delay(waitMs);
                continue;
              }
            }

            consecutiveFailures++;
            
            if (consecutiveFailures >= 3) {
              console.error('Too many consecutive batch failures, stopping migration');
              break;
            }
            
            // Wait longer before retrying batch
            await this.delay(5000 * consecutiveFailures);
          }
        }
      }

      // Final status update
      migrationStatus.lastProcessedDoc = lastProcessedDoc;
      migrationStatus.totalProcessed = processedCount;
      this.saveMigrationStatus(migrationStatus);
      this.monitor.stop();

      const summary = {
        collectionName,
        totalProcessed: processedCount,
        successful: successCount,
        failed: failedCount,
        skipped: skippedCount,
        completedAt: new Date().toISOString(),
        circuitBreakerState: this.circuitBreaker.getState(),
        monitoringReport: this.monitor.generateReport()
      };

      console.log('Migration completed:', summary);
      console.log('Final monitoring report:', this.monitor.generateReport());
      return summary;

    } catch (error) {
      console.error('Migration failed:', error);
      this.monitor.logError(error, { collectionName: collectionName, operation: 'migration_collection' });
      this.monitor.stop();
      throw error;
    }
  }

  // Migrate all collections defined by Firestore rules
  async migrateAllCollections(options = {}) {
    const collections = options.collections || [
      "users",
      "products",
      "order",
      "promo",
      "siteImages",
      "error",
    ];

    const summaries = [];

    for (const collectionName of collections) {
      try {
        console.log(`\n=== Migrating collection: ${collectionName} ===`);
        const summary = await this.migrateCollection(collectionName, options);
        summaries.push({ collectionName, ...summary });
      } catch (error) {
        console.error(`Failed migrating collection ${collectionName}:`, error.message);
        summaries.push({
          collectionName,
          error: error.message,
          failed: true,
        });
      }
    }

    return summaries;
  }

  // Retry failed migrations
  async retryFailedMigrations(collectionName) {
    const migrationStatus = this.loadMigrationStatus();
    const failedDocs = migrationStatus.failed;
    
    if (failedDocs.length === 0) {
      console.log('No failed migrations to retry');
      return;
    }

    console.log(`Retrying ${failedDocs.length} failed migrations`);
    
    let successCount = 0;
    let stillFailedCount = 0;

    for (const failedDoc of failedDocs) {
      try {
        const doc = await firebase.db.collection(collectionName).doc(failedDoc.documentId).get();
        if (doc.exists) {
          const result = await this.migrateDocument(collectionName, failedDoc.documentId, doc.data());
          
          if (result.success) {
            successCount++;
            // Remove from failed list and add to completed
            migrationStatus.failed = migrationStatus.failed.filter(
              f => f.documentId !== failedDoc.documentId
            );
            migrationStatus.completed.push(failedDoc.documentId);
          } else {
            stillFailedCount++;
            // Update error message
            const failedIndex = migrationStatus.failed.findIndex(
              f => f.documentId === failedDoc.documentId
            );
            if (failedIndex !== -1) {
              migrationStatus.failed[failedIndex] = {
                ...failedDoc,
                error: result.error,
                lastRetry: new Date().toISOString()
              };
            }
          }
        }
      } catch (error) {
        console.error(`Failed to retry document ${failedDoc.documentId}:`, error.message);
        stillFailedCount++;
      }
    }

    this.saveMigrationStatus(migrationStatus);
    
    console.log(`Retry completed: ${successCount} successful, ${stillFailedCount} still failed`);
    return { successCount, stillFailedCount };
  }

  // Generate migration report
  generateReport() {
    const migrationStatus = this.loadMigrationStatus();
    
    const report = {
      timestamp: new Date().toISOString(),
      totalProcessed: migrationStatus.totalProcessed,
      completed: migrationStatus.completed.length,
      failed: migrationStatus.failed.length,
      failedDocuments: migrationStatus.failed,
      successRate: migrationStatus.totalProcessed > 0 
        ? (migrationStatus.completed.length / migrationStatus.totalProcessed * 100).toFixed(2) + '%'
        : '0%'
    };

    // Save report to file
    const reportFileName = `migration-report-${Date.now()}.json`;
    fs.writeFileSync(reportFileName, JSON.stringify(report, null, 2));
    
    console.log('Migration report generated:', reportFileName);
    return report;
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up migration status (for testing or reset)
  cleanup() {
    if (fs.existsSync(this.migrationStatusFile)) {
      fs.unlinkSync(this.migrationStatusFile);
      console.log('Migration status file removed');
    }
  }
}

export default FirebaseToB2Migration;