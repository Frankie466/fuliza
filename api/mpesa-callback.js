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
        const callbackData = req.body;
        
        console.log('M-Pesa Callback Received:', JSON.stringify(callbackData, null, 2));
        
        // Extract transaction details
        const stkCallback = callbackData.Body?.stkCallback;
        
        if (!stkCallback) {
            console.error('Invalid callback format');
            return res.json({
                ResultCode: 1,
                ResultDesc: 'Invalid callback format'
            });
        }
        
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;
        
        // Find transaction by checkoutRequestID
        let transactionRef = null;
        if (global.transactions) {
            for (const [ref, transaction] of global.transactions.entries()) {
                if (transaction.checkoutRequestID === checkoutRequestID) {
                    transactionRef = ref;
                    break;
                }
            }
        }
        
        if (transactionRef) {
            const transaction = global.transactions.get(transactionRef);
            
            if (resultCode === 0) {
                // Payment successful
                const callbackMetadata = stkCallback.CallbackMetadata;
                const items = callbackMetadata?.Item || [];
                
                transaction.status = 'completed';
                transaction.mpesaReceiptNumber = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
                transaction.transactionDate = items.find(i => i.Name === 'TransactionDate')?.Value;
                transaction.phoneNumber = items.find(i => i.Name === 'PhoneNumber')?.Value;
                transaction.updatedAt = new Date().toISOString();
                
                console.log(`✅ Payment completed for reference: ${transactionRef}`);
                console.log(`📱 M-Pesa Receipt: ${transaction.mpesaReceiptNumber}`);
                console.log(`💰 Amount: ${transaction.amount}`);
                
                // Here you would typically:
                // 1. Update your database
                // 2. Increase user's Fuliza limit
                // 3. Send confirmation email/SMS
                // 4. Log the transaction
                
            } else {
                // Payment failed
                transaction.status = 'failed';
                transaction.errorMessage = resultDesc;
                transaction.updatedAt = new Date().toISOString();
                
                console.log(`❌ Payment failed for reference: ${transactionRef}`, resultDesc);
            }
            
            global.transactions.set(transactionRef, transaction);
        } else {
            console.log('Transaction not found for CheckoutRequestID:', checkoutRequestID);
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
            ResultDesc: 'Failed to process callback'
        });
    }
}