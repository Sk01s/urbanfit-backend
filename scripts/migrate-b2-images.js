#!/usr/bin/env node

import B2ImageMigration from '../src/services/b2ImageMigration.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const options = {};

// Parse additional options
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    options.dryRun = true;
  } else if (args[i] === '--no-resume') {
    options.resume = false;
  } else if (args[i] === '--max') {
    options.maxProducts = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--ids') {
    options.specificIds = args[i + 1].split(',');
    i++;
  } else if (args[i] === '--batch-size') {
    options.batchSize = parseInt(args[i + 1]);
    i++;
  }
}

async function main() {
  const migration = new B2ImageMigration({
    batchSize: options.batchSize || 10
  });

  try {
    console.log('Initializing migration service...');
    await migration.initialize();

    switch (command) {
      case 'migrate':
        console.log('Starting B2 image collection migration...');
        console.log('Options:', options);

        const result = await migration.migrateAllProducts({
          resume: options.resume !== false,
          dryRun: options.dryRun || false,
          maxProducts: options.maxProducts || null,
          specificIds: options.specificIds || null
        });

        console.log('\nMigration Result:', result);
        break;

      case 'retry':
        console.log('Retrying failed migrations...');
        const retryResult = await migration.retryFailed();
        console.log('Retry Result:', retryResult);
        break;

      case 'report':
        console.log('Generating migration report...');
        const report = migration.generateReport();
        console.log('\nMigration Report:');
        console.log(JSON.stringify(report, null, 2));
        break;

      case 'cleanup':
        console.log('Cleaning up migration status...');
        migration.cleanup();
        console.log('Cleanup completed');
        break;

      default:
        console.log(`
B2 Image Collection Migration Tool

This tool migrates product images from Firebase Storage to Backblaze B2
and adds a new 'b2ImageCollection' field to each product document.

Usage: node migrate-b2-images.js <command> [options]

Commands:
  migrate     Migrate product images to B2 and add b2ImageCollection field
  retry       Retry failed migrations
  report      Generate migration report
  cleanup     Clean up migration status file

Options:
  --dry-run           Show what would be migrated without actually migrating
  --no-resume         Start from beginning instead of resuming
  --max <number>      Limit number of products to process
  --ids <id1,id2>     Migrate specific product IDs only
  --batch-size <n>    Number of products to process per batch (default: 10)

Examples:
  node migrate-b2-images.js migrate --dry-run
  node migrate-b2-images.js migrate --max 5
  node migrate-b2-images.js migrate --ids "product1,product2,product3"
  node migrate-b2-images.js migrate --no-resume
  node migrate-b2-images.js retry
  node migrate-b2-images.js report
  node migrate-b2-images.js cleanup

Environment Variables Required:
  B2_APPLICATION_KEY_ID    Backblaze B2 Application Key ID
  B2_APPLICATION_KEY       Backblaze B2 Application Key
  B2_BUCKET_NAME           Backblaze B2 Bucket Name
  B2_BUCKET_ID             Backblaze B2 Bucket ID (optional)
  B2_DOWNLOAD_URL          Backblaze B2 Download URL (optional)

The migration will:
1. Fetch all products from Firestore
2. For each product, collect 'image' and 'imageCollection' URLs
3. Download images from Firebase Storage
4. Upload them to Backblaze B2
5. Add a 'b2ImageCollection' field with the new B2 URLs

The b2ImageCollection field structure:
[
  {
    "id": "unique-uuid",
    "url": "https://..backblazeb2.com/file/bucket/...",
    "originalUrl": "https://firebasestorage.googleapis.com/...",
    "originalId": "original-image-id",
    "type": "main" | "collection",
    "fileId": "b2-file-id",
    "fileName": "b2-file-name",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
]
        `);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main();
