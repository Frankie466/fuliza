import { getAccessToken, getTimestamp, formatPhoneNumber } from '../lib/mpesa';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { phone, amount, reference, userId, description } = req.body;
        
        // Validate input
        if (!phone || !amount || !reference) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone, amount, and reference are required' 
            });
        }
        
        // Get M-Pesa access token
        const accessToken = await getAccessToken();
        
        // Format phone number
        const formattedPhone = formatPhoneNumber(phone);
        
        // Get timestamp and password
        const timestamp = getTimestamp();
        const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
        
        // Prepare STK Push request
        const stkData = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: `${process.env.VERCEL_URL || 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/mpesa-callback`,
            AccountReference: reference,
            TransactionDesc: description || 'Fuliza Increment Payment'
        };
        
        // Determine API URL based on environment
        const baseUrl = process.env.MPESA_ENVIRONMENT === 'production' 
            ? 'https://api.safaricom.co.ke' 
            : 'https://sandbox.safaricom.co.ke';
        
        // Make request to Daraja API
        const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkData)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('M-Pesa API Error:', data);
            throw new Error(data.errorMessage || 'Failed to initiate payment');
        }
        
        // Store transaction in memory (use a database in production)
        // This is a simple in-memory store for demo purposes
        if (!global.transactions) {
            global.transactions = new Map();
        }
        
        global.transactions.set(reference, {
            checkoutRequestID: data.CheckoutRequestID,
            phone: formattedPhone,
            amount: amount,
            userId: userId,
            status: 'pending',
            reference: reference,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        res.status(200).json({
            success: true,
            message: 'STK Push initiated successfully',
            checkoutRequestID: data.CheckoutRequestID,
            reference: reference
        });
        
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate payment'
        });
    }
}