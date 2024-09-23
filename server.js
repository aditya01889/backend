const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const PAYTM_MID = 'YOUR_PAYTM_MID';
const PAYTM_KEY = 'YOUR_PAYTM_KEY';
const PAYTM_WEBSITE = 'WEBSTAGING'; // Use 'DEFAULT' for production
const PAYTM_CALLBACK_URL = 'https://your-website.com/payment-success'; // Update with your actual callback URL

const SHIPROCKET_TOKEN = 'YOUR_SHIPROCKET_API_TOKEN';

// Paytm Generate Transaction Token
app.post('/create-paytm-transaction', (req, res) => {
    const { amount, email, phone } = req.body;

    const orderId = `ORDERID_${new Date().getTime()}`;  // Generate a unique order ID
    const paytmParams = {
        body: {
            requestType: "Payment",
            mid: PAYTM_MID,
            websiteName: PAYTM_WEBSITE,
            orderId: orderId,
            callbackUrl: PAYTM_CALLBACK_URL,
            txnAmount: {
                value: amount.toFixed(2),
                currency: "INR",
            },
            userInfo: {
                custId: email,
                mobile: phone
            }
        }
    };

    // Generate checksum and initiate transaction with Paytm
    axios.post(`https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction?mid=${PAYTM_MID}&orderId=${orderId}`, paytmParams, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        res.json({
            txnToken: response.data.body.txnToken,
            orderId: orderId
        });
    })
    .catch(error => {
        console.error('Error generating Paytm transaction token:', error.message);
        res.status(500).json({ error: 'Error generating Paytm transaction token' });
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
