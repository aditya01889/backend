// Load environment variables from .env files
require('dotenv').config();
const config = require('./config');  // Import the config file

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();

// Set security headers using helmet
app.use(helmet());

// Limit repeated requests
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Enable CORS for your frontend
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || config.allowedOrigins.includes(origin)) {
            callback(null, true);  // Allow the origin if it's in the allowedOrigins list or if no origin (server-side requests)
        } else {
            callback(new Error('Not allowed by CORS'));  // Block other origins
        }
    },
    methods: 'GET,POST',  // Allow only the methods you're using
    credentials: true,  // Allow credentials (if needed)
    allowedHeaders: ['Content-Type', 'Authorization'],  // Allow specific headers
};

app.use(cors(corsOptions));

app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(config.mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error: ', err));

// User schema
const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    address: String,
    subscription: {
        subscriptionId: String,  // Razorpay subscription ID
        frequency: String,
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

const User = mongoose.model('User', userSchema);

// Razorpay and Shiprocket tokens from config
const RAZORPAY_KEY_ID = config.razorpayKeyId;
const RAZORPAY_KEY_SECRET = config.razorpayKeySecret;
const SHIPROCKET_TOKEN = config.shiprocketToken;

// Razorpay Subscription Creation for multiple items
app.post('/create-razorpay-subscriptions', async (req, res) => {
    const { cart, email, phone } = req.body;

    try {
        const subscriptionIds = [];

        // Loop through each item in the cart and create a subscription
        for (const item of cart) {
            const subscriptionOptions = {
                plan_id: item.planId,
                customer_notify: 1,
                total_count: 12, // 12 billing cycles (weekly)
                quantity: item.quantity,
                start_at: Math.floor(Date.now() / 1000) + 60
            };

            const response = await axios.post('https://api.razorpay.com/v1/subscriptions', subscriptionOptions, {
                auth: {
                    username: RAZORPAY_KEY_ID,
                    password: RAZORPAY_KEY_SECRET
                }
            });

            subscriptionIds.push({
                itemName: item.name,
                subscriptionId: response.data.id
            });
        }

        res.json({
            subscriptionIds,
            message: 'Subscriptions created successfully'
        });

    } catch (error) {
        console.error('Error creating Razorpay subscriptions:', error.message);
        res.status(500).json({ error: 'Error creating Razorpay subscriptions' });
    }
});

// Razorpay Webhook for Subscription Payments
app.post('/razorpay-webhook', (req, res) => {
    const webhookBody = req.body;

    if (webhookBody.event === 'subscription.charged') {
        const subscriptionId = webhookBody.payload.subscription.entity.id;
        const customerId = webhookBody.payload.subscription.entity.customer_id;

        handleSubscriptionCharged(subscriptionId, customerId)
            .then(() => res.status(200).send('Webhook handled successfully'))
            .catch(err => {
                console.error('Error handling subscription charged webhook:', err);
                res.status(500).send('Error processing webhook');
            });
    } else {
        res.status(400).send('Unhandled webhook event');
    }
});

// Handling the subscription charge
async function handleSubscriptionCharged(subscriptionId, customerId) {
    try {
        const user = await User.findOne({ 'subscription.subscriptionId': subscriptionId });

        if (user) {
            createShiprocketOrder(user);
        } else {
            throw new Error('User not found for subscription ID: ' + subscriptionId);
        }
    } catch (error) {
        console.error('Error in handleSubscriptionCharged:', error);
        throw error;
    }
}

// Shiprocket Order Creation
app.post('/create-shiprocket-order', (req, res) => {
    const { cart, ...userData } = req.body;

    const orderDetails = {
        "order_id": `ORDER_${new Date().getTime()}`,
        "order_date": new Date().toISOString(),
        "pickup_location": "Primary Pickup Location",
        "billing_customer_name": userData.name,
        "billing_address": userData.address,
        "billing_city": "Noida",
        "billing_pincode": "201301",
        "billing_country": "India",
        "order_items": cart.map(item => ({
            name: item.name,
            sku: item.sku,
            units: item.quantity,
            selling_price: item.price
        }))
    };

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

// Cron job to create recurring orders
cron.schedule('0 0 * * *', async () => {
    console.log('Running job every day at midnight');
    const usersWithSubscriptions = await getUsersWithActiveSubscriptions();

    usersWithSubscriptions.forEach(user => {
        createShiprocketOrder(user);
    });
});

// Fetch users with active subscriptions
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
        "order_id": `ORDER_${new Date().getTime()}`,
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

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
