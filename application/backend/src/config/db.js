const mysql = require('mysql2');

// Create connection pool using environment variables
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z', // Use UTC to prevent timezone conversion issues
  dateStrings: true // Return dates as strings to preserve exact values
});

// Export promise-based pool for async/await support
const promisePool = pool.promise();

// Test connection function
const testConnection = async () => {
  try {
    const connection = await promisePool.getConnection();
    console.log('✓ Database connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
};

module.exports = {
  pool: promisePool,
  testConnection
};
