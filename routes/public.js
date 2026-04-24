const express = require('express');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');

const router = express.Router();

router.get('/unsubscribe/:leadId', async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.leadId);
        if (lead) {
            lead.status = 'unsubscribed';
            await lead.save();

            // Also stop all active sequences for this lead immediately
            await Campaign.updateMany(
                { 'leadStates.leadId': lead._id },
                { $set: { 'leadStates.$[elem].completed': true } },
                { arrayFilters: [{ 'elem.leadId': lead._id }] }
            );

            res.send(`
                <div style="font-family: system-ui, -apple-system, sans-serif, Arial; text-align: center; margin-top: 80px; padding: 20px;">
                    <div style="max-width: 400px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
                        <svg style="width: 48px; height: 48px; color: #10b981; margin: 0 auto 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <h2 style="color: #0f172a; margin-top: 0;">Unsubscribed Successfully</h2>
                        <p style="color: #64748b; font-size: 15px; margin-bottom: 0;">You have been removed from our active mailing list and will no longer receive these automated emails. You can safely close this window.</p>
                    </div>
                </div>
            `);
        } else {
            res.status(404).send('Invalid unsubscribe link.');
        }
    } catch (err) {
        res.status(500).send('Error processing unsubscribe request.');
    }
});

module.exports = router;
