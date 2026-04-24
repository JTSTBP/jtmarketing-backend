const express = require('express');
const storage = require('../storage');
const authMiddleware = require('../middleware/auth');
const emailService = require('../services/emailService');
const Account = require('../models/Account');

const router = express.Router();

// Get all campaigns for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const campaigns = await storage.getCampaigns(req.user.id);
        res.json(campaigns);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching campaigns', error: error.message });
    }
});

// Get active queue across all campaigns
router.get('/active-queue', authMiddleware, async (req, res) => {
    try {
        const queue = await storage.getActiveQueue(req.user.id);
        res.json(queue);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching active queue', error: error.message });
    }
});

// Create a new campaign
router.post('/', authMiddleware, async (req, res) => {
    try {
        const campaign = await storage.addCampaign(req.user.id, req.body);
        res.status(201).json(campaign);
    } catch (error) {
        res.status(500).json({ message: 'Error creating campaign', error: error.message });
    }
});

// Update a campaign
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await storage.updateCampaign(req.user.id, req.params.id, req.body);
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        res.json(campaign);
    } catch (error) {
        res.status(500).json({ message: 'Error updating campaign', error: error.message });
    }
});

// Bulk status update
router.post('/bulk-status', authMiddleware, async (req, res) => {
    try {
        const { ids, status } = req.body;
        await storage.updateCampaignStatus(req.user.id, ids, status);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating campaigns', error: error.message });
    }
});

// Bulk delete
router.post('/bulk-delete', authMiddleware, async (req, res) => {
    try {
        const { ids } = req.body;
        await storage.deleteCampaigns(req.user.id, ids);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting campaigns', error: error.message });
    }
});

// Delete a single campaign
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await storage.deleteCampaign(req.user.id, req.params.id);
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting campaign', error: error.message });
    }
});

// Toggle lead pause
router.post('/:campaignId/leads/:leadId/pause', authMiddleware, async (req, res) => {
    try {
        const result = await storage.toggleLeadPause(req.user.id, req.params.campaignId, req.params.leadId);
        if (!result) return res.status(404).json({ message: 'Lead or campaign not found' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error toggling lead pause', error: error.message });
    }
});

// Stop lead sequence
router.post('/:campaignId/leads/:leadId/stop', authMiddleware, async (req, res) => {
    try {
        const result = await storage.stopLeadSequence(req.user.id, req.params.campaignId, req.params.leadId);
        if (!result) return res.status(404).json({ message: 'Lead or campaign not found' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error stopping lead sequence', error: error.message });
    }
});

// Direct send one-off email
router.post('/direct-send', authMiddleware, async (req, res) => {
    try {
        const { accountId, to, subject, body } = req.body;
        if (!accountId || !to || !subject || !body) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const account = await Account.findOne({ _id: accountId, userId: req.user.id });
        if (!account) return res.status(404).json({ message: 'Account not found' });

        let attachments = [];
        let parsedBody = body.split(/(!\[.*?\]\(.*?\))/g).map(part => {
            const match = part.match(/!\[.*?\]\((.*?)\)/);
            if (match) return `<img src="${match[1]}" alt="Inserted" style="width: 100%; height: auto; border-radius: 20px; margin: 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />`;
            return part.includes('<') ? part : part.replace(/\n/g, '<br/>');
        }).join('');

        // Process inline images
        let processedBody = parsedBody;
        const imgRegex = /<img[^>]+src="([^">]+)"/gi;
        let match;
        const path = require('path');
        const fs = require('fs');
        while ((match = imgRegex.exec(parsedBody)) !== null) {
            const originalSrc = match[1];
            if (originalSrc.includes('/uploads/')) {
                const filename = originalSrc.split('/uploads/')[1];
                const localPath = path.join(__dirname, '..', 'uploads', filename);
                if (fs.existsSync(localPath)) {
                    const cid = 'img_' + Date.now() + '_' + Math.floor(Math.random()*1000) + '@jtcrm';
                    const base64Data = fs.readFileSync(localPath, { encoding: 'base64' });
                    attachments.push({ filename: filename, base64Data: base64Data, cid: cid });
                    processedBody = processedBody.replace(originalSrc, 'cid:' + cid);
                }
            }
        }

        const isFromTemplate = req.body.templateId ? true : false;
        const containsHtml = /<[a-z][\s\S]*>/i.test(processedBody);
        const isHtmlBody = isFromTemplate || containsHtml;

        let finalBodyHtml = processedBody;

        if (isHtmlBody) {
            // Default to #ffffff since we don't have the backgroundColor here
            const bgColor = '#ffffff';
            finalBodyHtml = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <style>
                        img { max-width: 100%; height: auto; border-radius: 12px; margin: 16px 0; }
                        p { margin-top: 0; margin-bottom: 16px; }
                    </style>
                </head>
                <body style="margin:0; padding:0; background-color:${bgColor};">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bgColor}; min-height:100vh;">
                        <tr>
                            <td align="center" style="padding: 40px 20px; background-color:${bgColor};">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
                                    <tr>
                                        <td style="padding: 40px; font-family: system-ui, -apple-system, sans-serif, Arial; color: #334155; font-size: 16px; line-height: 1.6; text-align: left;">
                                            ${processedBody}
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `;
        } else {
            finalBodyHtml = `
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td align="center" style="padding: 20px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto;">
                                <tr>
                                    <td style="font-family: system-ui, -apple-system, sans-serif, Arial; color: #334155; font-size: 16px; line-height: 1.6; text-align: left;">
                                        ${processedBody}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `;
        }

        await emailService.sendEmail(account, to, subject, finalBodyHtml, attachments);
        res.json({ success: true, message: 'Email sent successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error sending email', error: error.message });
    }
});

module.exports = router;
