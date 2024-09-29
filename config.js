require('dotenv').config(); // Loads environment variables from .env file

const config = {
  // Razorpay config
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,

  // Shiprocket token
  shiprocketToken: process.env.SHIPROCKET_TOKEN,

  // MongoDB connection URI
  mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/cozycat', // Default fallback to local MongoDB URI

  // Server details
  port: process.env.PORT || 3000,

  // Allow origins for CORS (comma-separated values in .env, split into an array)
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3001'] // Default fallback if not set
};

module.exports = config;
