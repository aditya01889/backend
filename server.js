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

// Replace with your actual Paytm MID, Key, and Website values
const PAYTM_MID = process.env.PAYTM_MID || 'YOUR_ACTUAL_PAYTM_MID';
const PAYTM_KEY = process.env.PAYTM_KEY || 'YOUR_ACTUAL_PAYTM_KEY';
const PAYTM_WEBSITE = process.env.PAYTM_WEBSITE || 'DEFAULT'; // Use 'WEBSTAGING' for testing, 'DEFAULT' for production
const PAYTM_CALLBACK_URL = process.env.PAYTM_CALLBACK_URL || 'https://cozycatkitchen-backend.vercel.app/payment-success'; // Update with your actual callback URL

// Replace with your actual Shiprocket API token
const SHIPROCKET_TOKEN = process.env.SHIPROCKET_TOKEN || 'YOUR_ACTUAL_SHIPROCKET_API_TOKEN';

// Paytm Create Subscription (Recurring Payment)
app.post('/create-paytm-subscription', (req, res) => {
    const { amount, email, phone, subscriptionFrequency } = req.body;

    const orderId = `ORDERID_${new Date().getTime()}`;  // Generate unique order ID
    const paytmParams = {
        body: {
            requestType: "Subscription",
            mid: PAYTM_MID,
            websiteName: PAYTM_WEBSITE,
            orderId: orderId,
            callbackUrl: PAYTM_CALLBACK_URL,
            txnAmount: {
                value: amount.toFixed(2),
                currency: "INR",
            },
            subscriptionDetails: {
                frequency: subscriptionFrequency, // Example: 'WEEKLY', 'MONTHLY'
                amount: amount,
                startDate: new Date().toISOString(),
                customer: {
                    custId: email,
                    mobile: phone
                }
            }
        }
    };

    // Call Paytm API to create subscription
    axios.post(`https://securegw.paytm.in/subscription/initiate`, paytmParams, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        res.json({
            subscriptionId: response.data.body.subscriptionId,
            orderId: orderId
        });
    })
    .catch(error => {
        console.error('Error creating Paytm subscription:', error.message);
        res.status(500).json({ error: 'Error creating Paytm subscription' });
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
