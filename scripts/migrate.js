#!/usr/bin/env node

import FirebaseToB2Migration from '../src/services/migration.js';
import dotenv from 'dotenv';

// Load environment variables from backend root
dotenv.config({ path: '../.env' });

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const collectionName = args[1];
const options = {};

// Parse additional options
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    options.dryRun = true;
  } else if (args[i] === '--resume') {
    options.resume = args[i + 1] !== 'false';
  } else if (args[i] === '--max-docs') {
    options.maxDocuments = parseInt(args[i + 1]);
  } else if (args[i] === '--ids') {
    options.specificIds = args[i + 1].split(',');
  } else if (args[i] === '--collections') {
    options.collections = args[i + 1].split(',');
  }
}

async function main() {
  const migration = new FirebaseToB2Migration();
  
  try {
    console.log('Initializing migration service...');
    await migration.initialize();
    
    switch (command) {
      case 'migrate':
        if (!collectionName) {
          console.error('Please specify a collection name');
          process.exit(1);
        }
        
        console.log(`Starting migration for collection: ${collectionName}`);
        console.log('Options:', options);
        
        const result = await migration.migrateCollection(collectionName, options);
        console.log('Migration completed:', result);
        break;
        
      case 'retry':
        if (!collectionName) {
          console.error('Please specify a collection name');
          process.exit(1);
        }
        
        console.log(`Retrying failed migrations for collection: ${collectionName}`);
        const retryResult = await migration.retryFailedMigrations(collectionName);
        console.log('Retry completed:', retryResult);
        break;

      case 'migrate-all':
        console.log('Starting migration for all collections');
        console.log('Options:', options);
        const allResults = await migration.migrateAllCollections(options);
        console.log('All collections migration completed:', allResults);
        break;
        
      case 'report':
        console.log('Generating migration report...');
        const report = migration.generateReport();
        console.log('Migration Report:', report);
        break;
        
      case 'cleanup':
        console.log('Cleaning up migration status...');
        migration.cleanup();
        console.log('Cleanup completed');
        break;
        
      default:
        console.log(`
Firebase Storage to Backblaze B2 Migration Tool

Usage: node migrate.js <command> <collection> [options]

Commands:
  migrate <collection>     Migrate documents from specified collection
  migrate-all              Migrate all collections (users, products, order, promo, siteImages, error)
  retry <collection>       Retry failed migrations for specified collection
  report                   Generate migration report
  cleanup                  Clean up migration status files

Options:
  --dry-run                Show what would be migrated without actually migrating
  --resume false           Start from beginning instead of resuming
  --max-docs <number>      Limit number of documents to process
  --ids <id1,id2>          Migrate specific document IDs
  --collections <a,b,c>    Override default collection list for migrate-all

Examples:
  node migrate.js migrate products --dry-run
  node migrate.js migrate products --max-docs 100
  node migrate.js migrate products --ids "prod1,prod2,prod3"
  node migrate.js migrate-all
  node migrate.js migrate-all --collections "users,products"
  node migrate.js retry products
  node migrate.js report
  node migrate.js cleanup

Environment Variables Required:
  B2_APPLICATION_KEY_ID    Backblaze B2 Application Key ID
  B2_APPLICATION_KEY         Backblaze B2 Application Key
  B2_BUCKET_NAME           Backblaze B2 Bucket Name
  B2_BUCKET_ID             Backblaze B2 Bucket ID (optional)
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