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
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);

// Enable CORS for your frontend
const allowedOrigins = ['https://aditya01889.github.io', 'http://localhost:3001'];

app.use(cors({
    origin: function (origin, callback) {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: 'GET,POST',
    credentials: true  // Allow credentials (optional, if needed)
}));

app.use(bodyParser.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cozycat';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
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

// Razorpay keys
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'YOUR_RAZORPAY_KEY_ID';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_RAZORPAY_KEY_SECRET';

// Shiprocket token
const SHIPROCKET_TOKEN = process.env.SHIPROCKET_TOKEN || 'YOUR_SHIPROCKET_API_TOKEN';

// Razorpay Subscription Creation
app.post('/create-razorpay-subscription', (req, res) => {
    const { planId, email, phone } = req.body;

    const subscriptionOptions = {
        plan_id: planId,
        customer_notify: 1,
        total_count: 12, // 12 billing cycles (weekly)
        quantity: 1,
        start_at: Math.floor(Date.now() / 1000) + 60
    };

    axios.post('https://api.razorpay.com/v1/subscriptions', subscriptionOptions, {
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
