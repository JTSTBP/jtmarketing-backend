const express = require('express');
const { google } = require('googleapis');
const msal = require('@azure/msal-node');
const storage = require('../storage');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Google Config
const googleConfig = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL}/api/auth/google/callback`,
};

const createGoogleAuthClient = () => {
    return new google.auth.OAuth2(
        googleConfig.clientId,
        googleConfig.clientSecret,
        googleConfig.redirectUri
    );
};

// Microsoft Config
const msalConfig = {
    auth: {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        authority: `https://login.microsoftonline.com/common`,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    }
};
const pca = new msal.ConfidentialClientApplication(msalConfig);

// Google Routes
router.get('/google/url', authMiddleware, (req, res) => {
    const client = createGoogleAuthClient();
    const url = client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'openid',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ],

        prompt: 'consent',
        state: req.user.id.toString()   // pass userId via state — survives the redirect
    });
    res.json({ url });
});

router.get('/google/callback', async (req, res) => {
    const { code, state } = req.query;
    const userId = state;   // recovered from Google's redirect

    if (!userId) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=error&message=session_expired`);
    }

    const client = createGoogleAuthClient();
    try {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();

        const account = {
            email: userInfo.data.email,
            provider: 'google',
            tokens: tokens,
            dailyLimit: 2000,
            status: 'active'
        };

        await storage.addAccount(userId, account);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=success`);
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=error`);
    }
});

// Microsoft Routes
router.get('/microsoft/url', authMiddleware, async (req, res) => {
    const authCodeUrlParameters = {
        scopes: ["user.read", "mail.read", "mail.send", "offline_access"],
        redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${process.env.BACKEND_URL}/api/auth/microsoft/callback`,
        state: req.user.id.toString()   // pass userId via state — survives the redirect
    };

    try {
        const response = await pca.getAuthCodeUrl(authCodeUrlParameters);
        res.json({ url: response });
    } catch (error) {
        console.error('Microsoft URL Error:', error);
        res.status(500).json({ error: 'Failed to generate Microsoft URL' });
    }
});

router.get('/microsoft/callback', async (req, res) => {
    const { code, state } = req.query;
    const userId = state;   // recovered from Microsoft's redirect

    if (!userId) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=error&message=session_expired`);
    }

    const tokenRequest = {
        code,
        scopes: ["user.read", "mail.read", "mail.send", "offline_access"],
        redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${process.env.BACKEND_URL}/api/auth/microsoft/callback`,
    };

    try {
        const response = await pca.acquireTokenByCode(tokenRequest);
        const account = {
            email: response.account.username,
            provider: 'microsoft',
            tokens: response,
            dailyLimit: 10000,
            status: 'active'
        };

        await storage.addAccount(userId, account);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=success`);
    } catch (error) {
        console.error('Microsoft Auth Error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/email-accounts?status=error`);
    }
});

// Account Management
router.get('/accounts', authMiddleware, async (req, res) => {
    const accounts = await storage.getAccounts(req.user.id);
    res.json(accounts);
});

router.delete('/accounts/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    await storage.deleteAccount(req.user.id, id);
    res.json({ success: true });
});

module.exports = router;
