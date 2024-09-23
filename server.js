const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');  // For scheduling recurring Shiprocket shipments

const app = express();
app.use(bodyParser.json());

const PAYTM_MID = 'YOUR_PAYTM_MID';
const PAYTM_KEY = 'YOUR_PAYTM_KEY';
const PAYTM_WEBSITE = 'WEBSTAGING'; // Use 'DEFAULT' for production
const PAYTM_CALLBACK_URL = 'https://your-website.com/payment-success'; // Update with your actual callback URL

const SHIPROCKET_TOKEN = 'YOUR_SHIPROCKET_API_TOKEN';

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
cron.schedule('0 0 * * *', () => {
    console.log('Running a job every day at midnight');

    // Fetch the users with active subscriptions from your database
    const usersWithSubscriptions = getUsersWithActiveSubscriptions();  // Mock function

    usersWithSubscriptions.forEach(user => {
        createShiprocketOrder(user);
    });
});

// Mock function to fetch users with active subscriptions
function getUsersWithActiveSubscriptions() {
    return [
        {
            name: "John Doe",
            address: "Noida",
            cart: [
                { name: "Kitten", sku: "item123", quantity: 1, price: 1499 }
            ]
        }
    ];
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
