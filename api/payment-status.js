import { getAccessToken, getTimestamp } from '../lib/mpesa';

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

    if (req.method !== 'GET') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { reference } = req.query;
        
        if (!reference) {
            return res.status(400).json({
                success: false,
                message: 'Reference is required'
            });
        }
        
        // Check if transaction exists in memory
        if (!global.transactions || !global.transactions.has(reference)) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        const transaction = global.transactions.get(reference);
        
        // If already completed, return status
        if (transaction.status === 'completed') {
            return res.json({
                success: true,
                status: 'completed',
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                amount: transaction.amount,
                phone: transaction.phone,
                reference: transaction.reference
            });
        }
        
        // If failed, return status
        if (transaction.status === 'failed') {
            return res.json({
                success: false,
                status: 'failed',
                message: transaction.errorMessage || 'Payment failed'
            });
        }
        
        // Query Daraja API for status (optional - you can rely on callbacks)
        // This is kept simple for demo purposes
        
        res.json({
            success: true,
            status: 'pending',
            message: 'Payment still pending. Waiting for M-Pesa confirmation.'
        });
        
    } catch (error) {
        console.error('Payment status error:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to check payment status'
        });
    }
}