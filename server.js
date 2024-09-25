const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');  // For scheduling recurring Shiprocket shipments
const mongoose = require('mongoose');  // Mongoose for MongoDB
const helmet = require('helmet');  // Helmet for security headers
const rateLimit = require('express-rate-limit');  // Rate limiting middleware
const cors = require('cors');  // CORS middleware

const app = express();

// Set security headers using helmet
app.use(helmet());

// Limit repeated requests to public APIs and endpoints
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Enable CORS for your frontend only
app.use(cors({
    origin: 'https://yourfrontend.com',  // Replace with your actual frontend URL
    methods: 'GET,POST'  // Limit methods to what you need
}));

app.use(bodyParser.json());

// Replace with your actual MongoDB URI
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cozycat';

// Connect to MongoDB using Mongoose
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error: ', err));

// Define the User schema with subscription and cart details
const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    address: String,
    subscription: {
        frequency: String,  // 'WEEKLY', 'MONTHLY'
        active: Boolean,
        startDate: Date
    },
    cart: [{
        name: String,
        sku: String,
        price: Number,
        quantity: Number
    }]
});

// Create User model
const User = mongoose.model('User', userSchema);

// Replace with your actual Razorpay keys or other service keys
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'YOUR_RAZORPAY_KEY_ID';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_RAZORPAY_KEY_SECRET';

// Replace with your actual Shiprocket API token
const SHIPROCKET_TOKEN = process.env.SHIPROCKET_TOKEN || 'YOUR_ACTUAL_SHIPROCKET_API_TOKEN';

// Razorpay Create Subscription (Recurring Payment)
app.post('/create-razorpay-subscription', (req, res) => {
    const { planId, email, phone } = req.body;

    const subscriptionOptions = {
        plan_id: planId,  // Plan ID from Razorpay
        customer_notify: 1,  // Notify customer via SMS/Email
        total_count: 12,  // Number of billing cycles
        quantity: 1,  // Number of items per billing
        start_at: Math.floor(Date.now() / 1000) + 60,  // Subscription start time (1 minute from now)
        expire_by: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)  // 1-year expiration
    };

    axios.post(`https://api.razorpay.com/v1/subscriptions`, subscriptionOptions, {
        auth: {
            username: RAZORPAY_KEY_ID,
            password: RAZORPAY_KEY_SECRET
        }
    })
    .then(response => {
        res.json({
            subscription_id: response.data.id,
            message: 'Subscription created successfully'
        });
    })
    .catch(error => {
        console.error('Error creating Razorpay subscription:', error.message);
        res.status(500).json({ error: 'Error creating Razorpay subscription' });
    });
});

// Shiprocket Create Order
app.post('/create-shiprocket-order', (req, res) => {
    const orderDetails = req.body;

    axios.post('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', orderDetails, {
        headers: {
            'Authorization': `Bearer ${SHIPROCKET_TOKEN}`
        }
    })
    .then(response => {
        res.json(response.data);
    })
    .catch(error => {
        console.error('Error creating Shiprocket order:', error.message);
        res.status(500).json({ error: 'Error creating Shiprocket order' });
    });
});

// Schedule recurring Shiprocket orders (use cron for recurring tasks)
cron.schedule('0 0 * * *', async () => {
    console.log('Running a job every day at midnight');

    // Fetch the users with active subscriptions from MongoDB
    const usersWithSubscriptions = await getUsersWithActiveSubscriptions();

    usersWithSubscriptions.forEach(user => {
        createShiprocketOrder(user);
    });
});

// Function to fetch users with active subscriptions from MongoDB
async function getUsersWithActiveSubscriptions() {
    try {
        const users = await User.find({ 'subscription.active': true });
        return users;
    } catch (error) {
        console.error('Error fetching users with active subscriptions:', error);
        return [];
    }
}

// Create Shiprocket Order for users
function createShiprocketOrder(user) {
    const orderDetails = {
        "order_id": `ORDER_${new Date().getTime()}`,  // Unique ID for your order
        "order_date": new Date().toISOString(),
        "pickup_location": "Primary Pickup Location",
        "billing_customer_name": user.name,
        "billing_address": user.address,
        "billing_city": "Noida",
        "billing_pincode": "201301",
        "billing_country": "India",
        "order_items": user.cart.map(item => ({
            "name": item.name,
            "sku": item.sku,
            "units": item.quantity,
            "selling_price": item.price
        }))
    };

    axios.post('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', orderDetails, {
        headers: {
            'Authorization': `Bearer ${SHIPROCKET_TOKEN}`
        }
    })
    .then(response => {
        console.log('Recurring order created for user:', user.name);
    })
    .catch(error => {
        console.error('Error creating recurring Shiprocket order:', error.message);
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);  // Log error stack
    res.status(500).send('Something went wrong!');  // Generic message for clients
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
