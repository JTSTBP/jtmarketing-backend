const { google } = require('googleapis');
const axios = require('axios');
const msal = require('@azure/msal-node');

const makeMimeMessage = (to, subject, bodyHtml, attachments = []) => {
    if (!attachments || attachments.length === 0) {
        const raw = [
            `To: ${to}`,
            'Content-Type: text/html; charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
            '',
            bodyHtml
        ].join('\n');
        return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    const boundary = 'jtcrm_boundary_' + Date.now();
    let raw = [
        `To: ${to}`,
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/related; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        bodyHtml
    ];

    for (const att of attachments) {
        raw.push('');
        raw.push(`--${boundary}`);
        raw.push(`Content-Type: image/jpeg; name="${att.filename}"`);
        raw.push(`Content-Transfer-Encoding: base64`);
        if (att.cid) raw.push(`Content-ID: <${att.cid}>`);
        raw.push(`Content-Disposition: inline; filename="${att.filename}"`);
        raw.push('');
        // Chunk base64 to 76 chars per line for standard MIME
        const lines = att.base64Data.match(/.{1,76}/g) || [];
        raw.push(lines.join('\n'));
    }
    raw.push('');
    raw.push(`--${boundary}--`);
    
    return Buffer.from(raw.join('\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sendEmail = async (account, toEmail, subject, bodyHtml, attachments = []) => {
    // Safety check for dummy emails
    if (toEmail.endsWith('@example.com')) {
        console.log(`[EmailService - MOCK] Would send to ${toEmail} | Subject: ${subject} | Attachments: ${attachments.length}`);
        return true; 
    }

    if (account.provider === 'google') {
        return sendViaGoogle(account, toEmail, subject, bodyHtml, attachments);
    } else if (account.provider === 'microsoft') {
        return sendViaMicrosoft(account, toEmail, subject, bodyHtml, attachments);
    } else {
        throw new Error('Unsupported email provider');
    }
};

const sendViaGoogle = async (account, toEmail, subject, bodyHtml, attachments = []) => {
    try {
        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        client.setCredentials(account.tokens); // This will auto-refresh if needed based on tokens.refresh_token

        const gmail = google.gmail({ version: 'v1', auth: client });
        
        const rawMessage = makeMimeMessage(toEmail, subject, bodyHtml, attachments);

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: rawMessage
            }
        });

        console.log(`[EmailService] Google Mail sent successfully to ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`[EmailService] Error sending via Google:`, error.message);
        throw error;
    }
};

const sendViaMicrosoft = async (account, toEmail, subject, bodyHtml, attachments = []) => {
    try {
        // We use MSAL node to acquire token silently if possible using cache, or just use the token we have
        // But for simplicity if we stored the raw Graph API response, we might just try using the existing accessToken.
        // If it fails with 401, we would technically need to refresh it.
        const accessToken = account.tokens.accessToken;

        const payload = {
            message: {
                subject: subject,
                body: {
                    contentType: 'HTML',
                    content: bodyHtml
                },
                toRecipients: [
                    {
                        emailAddress: { address: toEmail }
                    }
                ]
            },
            saveToSentItems: 'true'
        };

        if (attachments && attachments.length > 0) {
            payload.message.attachments = attachments.map(att => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.filename,
                contentType: "image/jpeg",
                contentBytes: att.base64Data,
                isInline: !!att.cid,
                contentId: att.cid
            }));
        }

        await axios.post('https://graph.microsoft.com/v1.0/me/sendMail', payload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[EmailService] Microsoft Mail sent successfully to ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`[EmailService] Error sending via Microsoft:`, error.response?.data || error.message);
        throw error;
    }
};

const fetchRecentReplies = async (account, since) => {
    if (account.provider === 'google') {
        const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        client.setCredentials(account.tokens);
        const gmail = google.gmail({ version: 'v1', auth: client });

        // Build query: search for emails since 'since' timestamp
        // If 'since' is missing, fallback to last 1 hour
        let query = '';
        if (since) {
            const unixSeconds = Math.floor(new Date(since).getTime() / 1000);
            query = `after:${unixSeconds}`;
        } else {
            query = 'newer_than:1h';
        }

        const res = await gmail.users.messages.list({ userId: 'me', q: query });
        if (!res.data.messages) return [];

        const replies = [];
        for (const msg of res.data.messages) {
            const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            const headers = detail.data.payload.headers;
            
            // Only consider INCOMING messages (not sent by 'me')
            const labels = detail.data.labelIds || [];
            if (labels.includes('SENT')) continue;

            const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
            const emailMatch = fromHeader.match(/<(.+)>|(\S+@\S+)/);
            const fromEmail = emailMatch ? (emailMatch[1] || emailMatch[2]) : fromHeader;

            replies.push({
                id: msg.id,
                email: fromEmail.toLowerCase().trim(),
                snippet: detail.data.snippet,
                date: new Date(parseInt(detail.data.internalDate))
            });
        }
        return replies;
    } else if (account.provider === 'microsoft') {
        const accessToken = account.tokens.accessToken;
        
        let filter = '';
        if (since) {
            const iso = new Date(since).toISOString();
            filter = `&$filter=receivedDateTime ge ${iso}`;
        } else {
            // Last 1 hour fallback for MS Graph
            const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
            filter = `&$filter=receivedDateTime ge ${oneHourAgo}`;
        }

        const res = await axios.get(`https://graph.microsoft.com/v1.0/me/messages?$select=id,from,bodyPreview,receivedDateTime${filter}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!res.data.value) return [];

        return res.data.value
            .filter(msg => msg.from && msg.from.emailAddress) // Safety check
            .map(msg => ({
                id: msg.id,
                email: msg.from.emailAddress.address.toLowerCase().trim(),
                snippet: msg.bodyPreview,
                date: new Date(msg.receivedDateTime)
            }));
    }
    return [];
};

const markAsRead = async (account, messageId) => {
    try {
        if (account.provider === 'google') {
            const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
            client.setCredentials(account.tokens);
            const gmail = google.gmail({ version: 'v1', auth: client });
            await gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: {
                    ids: [messageId],
                    removeLabelIds: ['UNREAD']
                }
            });
        } else if (account.provider === 'microsoft') {
            const accessToken = account.tokens.accessToken;
            await axios.patch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
                isRead: true
            }, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            });
        }
    } catch (err) {
        console.error(`Failed to mark message ${messageId} as read:`, err.message);
    }
};

module.exports = { sendEmail, fetchRecentReplies, markAsRead };
