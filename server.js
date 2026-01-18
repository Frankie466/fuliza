const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables (set these in your .env file or hosting platform)
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://yourdomain.com/api/mpesa-callback';
const ENVIRONMENT = process.env.MPESA_ENVIRONMENT || 'sandbox'; // 'sandbox' or 'production'

// Daraja API URLs
const DARAJA_URLS = {
    sandbox: {
        auth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkpush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        query: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
    },
    production: {
        auth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkpush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        query: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
    }
};

// In-memory storage for transactions (use database in production)
const transactions = new Map();

// Get Daraja access token
async function getAccessToken() {
    try {
        const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
        const url = DARAJA_URLS[ENVIRONMENT].auth;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        throw new Error('Failed to get access token');
    }
}

// Generate timestamp for Daraja
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initiate M-Pesa payment
app.post('/api/initiate-payment', async (req, res) => {
    try {
        const { phone, amount, reference, userId, description } = req.body;
        
        // Validate input
        if (!phone || !amount || !reference) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone, amount, and reference are required' 
            });
        }
        
        // Format phone number
        let formattedPhone = phone;
        if (phone.startsWith('07')) {
            formattedPhone = `254${phone.substring(1)}`;
        } else if (phone.startsWith('+254')) {
            formattedPhone = phone.substring(1);
        } else if (phone.startsWith('254')) {
            formattedPhone = phone;
        } else if (phone.startsWith('7')) {
            formattedPhone = `254${phone}`;
        }
        
        // Get access token
        const accessToken = await getAccessToken();
        
        // Prepare STK Push request
        const timestamp = getTimestamp();
        const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
        
        const stkData = {
            BusinessShortCode: SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: CALLBACK_URL,
            AccountReference: reference,
            TransactionDesc: description || 'Fuliza Increment Payment'
        };
        
        // Make request to Daraja API
        const url = DARAJA_URLS[ENVIRONMENT].stkpush;
        const response = await axios.post(url, stkData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        // Store transaction
        transactions.set(reference, {
            checkoutRequestID: response.data.CheckoutRequestID,
            phone: formattedPhone,
            amount: amount,
            userId: userId,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        
        res.json({
            success: true,
            message: 'STK Push initiated successfully',
            checkoutRequestID: response.data.CheckoutRequestID,
            reference: reference
        });
        
    } catch (error) {
        console.error('Payment initiation error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || 'Failed to initiate payment'
        });
    }
});

// Check payment status
app.get('/api/payment-status/:reference', async (req, res) => {
    try {
        const { reference } = req.params;
        
        // Check if transaction exists
        const transaction = transactions.get(reference);
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // If already completed, return status
        if (transaction.status === 'completed') {
            return res.json({
                success: true,
                status: 'completed',
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                amount: transaction.amount,
                phone: transaction.phone
            });
        }
        
        // Query Daraja API for status
        const accessToken = await getAccessToken();
        const timestamp = getTimestamp();
        const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
        
        const queryData = {
            BusinessShortCode: SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: transaction.checkoutRequestID
        };
        
        const url = DARAJA_URLS[ENVIRONMENT].query;
        const response = await axios.post(url, queryData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        // Update transaction status based on response
        const resultCode = response.data.ResultCode;
        if (resultCode === '0') {
            transaction.status = 'completed';
            transaction.mpesaReceiptNumber = response.data.MpesaReceiptNumber;
            transaction.updatedAt = new Date();
            transactions.set(reference, transaction);
            
            res.json({
                success: true,
                status: 'completed',
                mpesaReceiptNumber: response.data.MpesaReceiptNumber,
                amount: transaction.amount,
                phone: transaction.phone
            });
        } else {
            transaction.status = 'failed';
            transaction.updatedAt = new Date();
            transactions.set(reference, transaction);
            
            res.json({
                success: false,
                status: 'failed',
                message: response.data.ResultDesc || 'Payment failed'
            });
        }
        
    } catch (error) {
        console.error('Payment status error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to check payment status'
        });
    }
});

// M-Pesa callback endpoint
app.post('/api/mpesa-callback', (req, res) => {
    try {
        const callbackData = req.body;
        
        // Log the callback for debugging
        console.log('M-Pesa Callback Received:', JSON.stringify(callbackData, null, 2));
        
        // Extract transaction details
        const stkCallback = callbackData.Body.stkCallback;
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;
        
        // Find transaction by checkoutRequestID
        let transactionRef = null;
        for (const [ref, transaction] of transactions.entries()) {
            if (transaction.checkoutRequestID === checkoutRequestID) {
                transactionRef = ref;
                break;
            }
        }
        
        if (transactionRef) {
            const transaction = transactions.get(transactionRef);
            
            if (resultCode === 0) {
                // Payment successful
                const callbackMetadata = stkCallback.CallbackMetadata;
                const item = callbackMetadata.Item;
                
                transaction.status = 'completed';
                transaction.mpesaReceiptNumber = item.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
                transaction.transactionDate = item.find(i => i.Name === 'TransactionDate')?.Value;
                transaction.phoneNumber = item.find(i => i.Name === 'PhoneNumber')?.Value;
                transaction.updatedAt = new Date();
                
                console.log(`Payment completed for reference: ${transactionRef}`);
            } else {
                // Payment failed
                transaction.status = 'failed';
                transaction.errorMessage = resultDesc;
                transaction.updatedAt = new Date();
                
                console.log(`Payment failed for reference: ${transactionRef}`, resultDesc);
            }
            
            transactions.set(transactionRef, transaction);
        }
        
        // Send acknowledgement to Daraja
        res.json({
            ResultCode: 0,
            ResultDesc: 'Success'
        });
        
    } catch (error) {
        console.error('Callback processing error:', error);
        res.status(500).json({
            ResultCode: 1,
            ResultDesc: 'Failed'
        });
    }
});

// Get all transactions (for admin purposes)
app.get('/api/transactions', (req, res) => {
    const transactionsArray = Array.from(transactions.entries()).map(([ref, data]) => ({
        reference: ref,
        ...data
    }));
    
    res.json({
        success: true,
        count: transactionsArray.length,
        transactions: transactionsArray
    });
});

// Serve frontend static files (if serving from same server)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${ENVIRONMENT}`);
    console.log(`Callback URL: ${CALLBACK_URL}`);
});