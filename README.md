# Urbanfit Backend - Firebase to Backblaze B2 Migration

This backend service provides comprehensive tools for migrating Firebase Storage media to Backblaze B2 storage while maintaining Firestore document integrity.

## 🚀 Quick Start

1. **Install dependencies:**
```bash
cd backend
npm install
```

2. **Set up Firebase Admin SDK:**
   
   **Option A: Using Service Account File (Recommended)**
   ```bash
   # Copy the service account template
   cp service-account.json.example service-account.json
   
   # Get your service account from Firebase Console:
   # 1. Go to Firebase Console > Project Settings > Service Accounts
   # 2. Click "Generate new private key"
   # 3. Copy the contents to service-account.json
   ```
   
   **Option B: Using Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Firebase Admin credentials
   # Get credentials from Firebase Console > Project Settings > Service Accounts
   ```

3. **Start the server:**
```bash
npm run dev  # Development mode with auto-reload
npm start    # Production mode
```

## 📁 Project Structure

```
backend/
├── src/
│   └── services/
│       ├── backblazeB2.js      # Backblaze B2 integration
│       ├── migration.js        # Main migration engine
│       └── migrationMonitor.js # Error handling & monitoring
├── scripts/
│   └── migrate.js             # CLI migration tool
├── logs/                      # Migration logs (auto-created)
├── server.js                  # Fastify API server
├── package.json               # Backend dependencies
└── .env.example              # Environment template
```

## 🔧 Available Scripts

### Development
```bash
npm run dev          # Start server with auto-reload
npm run start        # Start production server
```

### Migration Commands
```bash
npm run migrate:dry  # Test migration (dry run)
npm run migrate        # Run actual migration
npm run migrate:retry  # Retry failed migrations
npm run migrate:report # Generate migration report
npm run migrate:cleanup # Clean up migration status
```

## 🌐 API Endpoints

### File Upload
- `POST /api/upload` - Upload files to configured storage (Firebase/B2)

### Migration Status
- `GET /api/migration/status/:collection/:documentId` - Check single document
- `POST /api/migration/status/bulk` - Check multiple documents

### Migration Control
- `POST /api/migration/start` - Start migration job
- `GET /api/migration/status/:jobId` - Check job status
- `POST /api/migration/retry` - Retry failed migrations
- `GET /api/migration/report` - Generate migration report
- `GET /api/migration/stats?collection=products` - Get migration statistics

### Health Check
- `GET /health` - Server health status

## 📊 Migration Features

### ✅ Automated Migration
- Batch processing of Firestore documents
- Automatic Firebase Storage URL detection
- Atomic document updates with migration metadata
- Resume capability from last position

### ✅ Error Handling
- Retry logic with exponential backoff
- Circuit breaker pattern for resilience
- Comprehensive error logging and classification
- Graceful failure handling

### ✅ Monitoring
- Real-time progress tracking
- Detailed error statistics
- Performance metrics and reporting
- Migration recommendations

### ✅ Flexibility
- Dry-run mode for testing
- Selective document migration
- Configurable batch sizes and retry limits
- Support for both storage providers

## 🔐 Environment Configuration

### Required Variables
```bash
# Backblaze B2
B2_APPLICATION_KEY_ID=your_b2_key_id
B2_APPLICATION_KEY=your_b2_key
B2_BUCKET_NAME=your_bucket_name

# Firebase (copy from main project)
REACT_APP_FIREBASE_API_KEY=your_firebase_key
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
# ... other Firebase configs
```

### Optional Variables
```bash
# Migration Settings
USE_BACKBLAZE_B2_FOR_NEW_UPLOADS=false  # Use B2 for new uploads
MIGRATION_BATCH_SIZE=10                  # Documents per batch
MIGRATION_MAX_RETRIES=3                  # Retry attempts
MIGRATION_RETRY_DELAY=2000              # Base retry delay (ms)

# Server Settings
PORT=3001                               # Server port
NODE_ENV=development                    # Environment mode
```

## 🎯 Usage Examples

### CLI Migration
```bash
# Test migration (dry run)
node scripts/migrate.js migrate products --dry-run

# Migrate specific documents
node scripts/migrate.js migrate products --ids "prod1,prod2,prod3"

# Resume migration from last position
node scripts/migrate.js migrate products

# Start fresh (ignore previous progress)
node scripts/migrate.js migrate products --resume false
```

### API Usage
```bash
# Start migration via API
curl -X POST http://localhost:3001/api/migration/start \
  -H "Content-Type: application/json" \
  -d '{"collection": "products", "options": {"dryRun": false}}'

# Check migration status
curl http://localhost:3001/api/migration/status/products/PROD123

# Upload file
curl -X POST http://localhost:3001/api/upload \
  -F "file=@image.jpg"
```

## 📈 Monitoring

The migration system provides comprehensive monitoring:

- **Progress Tracking**: Real-time document processing status
- **Error Analysis**: Categorized error types and frequencies
- **Performance Metrics**: Processing speed and success rates
- **Health Monitoring**: Circuit breaker state and system health

Logs are automatically saved to the `logs/` directory:
- `migration-errors.json` - Detailed error log
- `migration-report-*.json` - Migration summary reports
- `migration-status.json` - Current migration progress

## 🔍 Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify B2 application key and Firebase credentials
   - Check environment variable names and values

2. **Rate Limiting**
   - Reduce `MIGRATION_BATCH_SIZE`
   - Increase `MIGRATION_RETRY_DELAY`

3. **Network Timeouts**
   - Check internet connectivity
   - Increase timeout values in B2 service

4. **Memory Issues**
   - Reduce batch size for large files
   - Process smaller document sets

### Debug Mode
Set `NODE_ENV=development` for detailed logging and error stack traces.

## 🔒 Security Notes

- Never commit actual `.env` files with credentials
- Use least-privilege IAM roles for both services
- Implement proper CORS settings for production
- Monitor for unusual migration patterns
- Validate file types and sizes before upload

## 📚 Additional Resources

- [Backblaze B2 Documentation](https://www.backblaze.com/b2/docs/)
- [Firebase Storage Documentation](https://firebase.google.com/docs/storage)
- [Fastify Documentation](https://www.fastify.io/docs/)

## 🤝 Support

For issues and questions:
1. Check the migration logs in `logs/` directory
2. Review the monitoring recommendations
3. Verify environment configuration
4. Test with small batches first
5. Check service status for Firebase and Backblaze B2