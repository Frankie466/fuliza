// M-Pesa Daraja API utilities

let cachedAccessToken = null;
let tokenExpiry = null;

// Get access token from Daraja API
export async function getAccessToken() {
    // Check if token is still valid (expires after 1 hour)
    if (cachedAccessToken && tokenExpiry && new Date() < tokenExpiry) {
        return cachedAccessToken;
    }
    
    try {
        const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
        
        const baseUrl = process.env.MPESA_ENVIRONMENT === 'production' 
            ? 'https://api.safaricom.co.ke' 
            : 'https://sandbox.safaricom.co.ke';
        
        const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get access token: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Cache the token
        cachedAccessToken = data.access_token;
        // Set expiry to 55 minutes from now (5 minutes before actual expiry)
        tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);
        
        return cachedAccessToken;
        
    } catch (error) {
        console.error('Error getting access token:', error);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// Generate timestamp for Daraja API
export function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Format phone number for M-Pesa
export function formatPhoneNumber(phone) {
    let formattedPhone = phone;
    
    if (phone.startsWith('07')) {
        formattedPhone = `254${phone.substring(1)}`;
    } else if (phone.startsWith('+254')) {
        formattedPhone = phone.substring(1);
    } else if (phone.startsWith('254')) {
        formattedPhone = phone;
    } else if (phone.startsWith('7')) {
        formattedPhone = `254${phone}`;
    } else if (phone.startsWith('0')) {
        formattedPhone = `254${phone.substring(1)}`;
    }
    
    return formattedPhone;
}