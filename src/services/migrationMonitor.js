import fs from 'fs';
import { EventEmitter } from 'events';

class MigrationMonitor extends EventEmitter {
  constructor() {
    super();
    this.errorLog = [];
    this.maxErrors = 1000;
    this.errorLogFile = 'logs/migration-errors.json';
    this.metrics = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      startTime: null,
      endTime: null,
      currentBatch: 0
    };
    this.loadErrorLog();
  }

  // Load existing error log
  loadErrorLog() {
    try {
      if (fs.existsSync(this.errorLogFile)) {
        const data = fs.readFileSync(this.errorLogFile, 'utf8');
        this.errorLog = JSON.parse(data);
      }
    } catch (error) {
      console.warn('Could not load error log:', error.message);
      this.errorLog = [];
    }
  }

  // Save error log
  saveErrorLog() {
    try {
      // Ensure logs directory exists
      const logsDir = 'logs';
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      fs.writeFileSync(this.errorLogFile, JSON.stringify(this.errorLog, null, 2));
    } catch (error) {
      console.error('Failed to save error log:', error.message);
    }
  }

  // Log error with context
  logError(error, context = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message || error,
      stack: error.stack,
      context: {
        ...context,
        documentId: context.documentId || null,
        collectionName: context.collectionName || null,
        url: context.url || null,
        retryCount: context.retryCount || 0
      },
      severity: this.determineSeverity(error, context)
    };

    this.errorLog.push(errorEntry);
    
    // Keep only the most recent errors
    if (this.errorLog.length > this.maxErrors) {
      this.errorLog = this.errorLog.slice(-this.maxErrors);
    }

    this.saveErrorLog();
    if (this.listenerCount('migrationError') > 0) {
      this.emit('migrationError', errorEntry);
    }
    
    console.error(`[${errorEntry.severity}] Migration error:`, errorEntry.message, context);
  }

  // Determine error severity
  determineSeverity(error, context) {
    const errorMessage = error.message || error;
    
    if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
      return 'WARNING';
    } else if (errorMessage.includes('auth') || errorMessage.includes('permission')) {
      return 'CRITICAL';
    } else if (context.retryCount >= 3) {
      return 'ERROR';
    } else {
      return 'INFO';
    }
  }

  // Log successful operation
  logSuccess(operation, context = {}) {
    const successEntry = {
      timestamp: new Date().toISOString(),
      operation: operation,
      context: context,
      type: 'success'
    };

    this.emit('success', successEntry);
    
    if (operation === 'document_migrated') {
      this.metrics.successful++;
    }
  }

  // Update metrics
  updateMetrics(update) {
    Object.assign(this.metrics, update);
    this.emit('metrics', this.metrics);
  }

  // Get current metrics
  getMetrics() {
    return {
      ...this.metrics,
      duration: this.metrics.startTime && this.metrics.endTime 
        ? this.metrics.endTime - this.metrics.startTime 
        : null,
      errorRate: this.metrics.totalProcessed > 0 
        ? (this.metrics.failed / this.metrics.totalProcessed) * 100 
        : 0
    };
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      totalErrors: this.errorLog.length,
      bySeverity: {},
      byType: {},
      recentErrors: this.errorLog.slice(-10),
      mostCommonErrors: []
    };

    // Group by severity
    this.errorLog.forEach(error => {
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    // Group by error type (extract from message)
    this.errorLog.forEach(error => {
      const errorType = this.extractErrorType(error.message);
      stats.byType[errorType] = (stats.byType[errorType] || 0) + 1;
    });

    // Most common errors
    const errorCounts = {};
    this.errorLog.forEach(error => {
      const key = error.message.substring(0, 100); // First 100 chars
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    });

    stats.mostCommonErrors = Object.entries(errorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }));

    return stats;
  }

  // Extract error type from message
  extractErrorType(message) {
    if (message.includes('network')) return 'network';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('auth')) return 'authentication';
    if (message.includes('permission')) return 'permission';
    if (message.includes('rate limit')) return 'rate_limit';
    if (message.includes('not found')) return 'not_found';
    return 'other';
  }

  // Generate monitoring report
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics(),
      errorStats: this.getErrorStats(),
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  // Generate recommendations based on errors and metrics
  generateRecommendations() {
    const recommendations = [];
    const errorStats = this.getErrorStats();
    const metrics = this.getMetrics();

    // Check error rate
    if (metrics.errorRate > 10) {
      recommendations.push({
        type: 'HIGH_ERROR_RATE',
        priority: 'HIGH',
        message: 'Error rate is above 10%. Consider investigating the root cause.',
        suggestion: 'Review recent error logs and check for systematic issues.'
      });
    }

    // Check for network errors
    if (errorStats.byType.network > 5) {
      recommendations.push({
        type: 'NETWORK_ISSUES',
        priority: 'MEDIUM',
        message: 'Multiple network errors detected.',
        suggestion: 'Check network connectivity and consider implementing exponential backoff.'
      });
    }

    // Check for rate limiting
    if (errorStats.byType.rate_limit > 0) {
      recommendations.push({
        type: 'RATE_LIMITING',
        priority: 'HIGH',
        message: 'Rate limiting detected.',
        suggestion: 'Reduce batch size or add delays between requests.'
      });
    }

    // Check for authentication errors
    if (errorStats.byType.authentication > 0) {
      recommendations.push({
        type: 'AUTH_ISSUES',
        priority: 'CRITICAL',
        message: 'Authentication errors detected.',
        suggestion: 'Verify API keys and credentials for both Firebase and Backblaze B2.'
      });
    }

    return recommendations;
  }

  // Reset metrics
  resetMetrics() {
    this.metrics = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
      startTime: null,
      endTime: null,
      currentBatch: 0
    };
  }

  // Start monitoring
  start() {
    this.metrics.startTime = Date.now();
    this.emit('start');
    console.log('Migration monitoring started');
  }

  // Stop monitoring
  stop() {
    this.metrics.endTime = Date.now();
    this.emit('stop', this.getMetrics());
    console.log('Migration monitoring stopped');
  }
}

export default MigrationMonitor;

// Circuit breaker for handling cascading failures
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  // Execute function with circuit breaker protection
  async execute(fn, shouldTrip = () => true) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN');
      } else {
        this.state = 'HALF_OPEN';
        console.log('Circuit breaker entering HALF_OPEN state');
      }
    }

    try {
      const result = await fn();
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
        console.log('Circuit breaker closed after successful operation');
      }

      return result;

    } catch (error) {
      if (shouldTrip(error)) {
        this.recordFailure();
      }
      throw error;
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  // Record a failure
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      console.log(`Circuit breaker opened after ${this.failureCount} failures`);
    }
  }

  // Get current state
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null
    };
  }
}

// Retry manager for handling failed operations
class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitter = options.jitter !== false; // Default to true
    this.monitor = options.monitor || null;
  }

  // Execute function with retry logic
  async execute(fn, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt);
          console.log(`Retrying operation (attempt ${attempt}/${this.maxRetries}) after ${delay}ms delay`);
          await this.sleep(delay);
        }

        const result = await fn(attempt);
        
        if (attempt > 0 && this.monitor) {
          this.monitor.updateMetrics({ retried: this.monitor.metrics.retried + 1 });
        }

        return result;

      } catch (error) {
        lastError = error;
        
        if (this.monitor) {
          this.monitor.logError(error, { ...context, retryCount: attempt });
        }

        // Don't retry on certain types of errors
        if (this.isNonRetryableError(error)) {
          console.log(`Non-retryable error detected, stopping retries: ${error.message}`);
          break;
        }

        if (attempt === this.maxRetries) {
          console.log(`Max retries (${this.maxRetries}) reached, operation failed`);
        }
      }
    }

    throw lastError;
  }

  // Calculate delay with exponential backoff and jitter
  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1);
    const jitteredDelay = this.jitter 
      ? exponentialDelay * (0.5 + Math.random() * 0.5)
      : exponentialDelay;
    
    return Math.min(jitteredDelay, this.maxDelay);
  }

  // Check if error is non-retryable
  isNonRetryableError(error) {
    const message = error.message || error;
    
    // Don't retry authentication errors (they won't succeed on retry)
    if (message.includes('auth') || message.includes('permission denied')) {
      return true;
    }
    
    // Don't retry validation errors
    if (message.includes('validation') || message.includes('invalid')) {
      return true;
    }

    // Don't retry missing files
    if (message.includes('status code 404') || message.includes('404')) {
      return true;
    }
    
    return false;
  }

  // Sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { MigrationMonitor, RetryManager, CircuitBreaker };