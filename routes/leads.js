const express = require('express');
const storage = require('../storage');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get leads stats
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const leads = await storage.getLeads(req.user.id);
        res.json({
            total: leads.length,
            active: leads.filter(l => l.status === 'active').length,
            pending: leads.filter(l => l.status === 'pending').length,
            inactive: leads.filter(l => l.status === 'inactive').length
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching stats', error: error.message });
    }
});

// Get all leads for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, industry, search, sort } = req.query;
        const leads = await storage.getLeads(req.user.id, { status, industry, search, sort });
        res.json(leads);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching leads', error: error.message });
    }
});

// Bulk delete leads
router.delete('/bulk', authMiddleware, async (req, res) => {
    try {
        const { leadIds } = req.body;
        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ message: 'Invalid lead IDs' });
        }
        await storage.deleteLeads(req.user.id, leadIds);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting leads', error: error.message });
    }
});

// Bulk update lead groups
router.post('/bulk-group', authMiddleware, async (req, res) => {
    try {
        const { leadIds, group } = req.body;
        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ message: 'Invalid lead IDs' });
        }
        await storage.bulkUpdateLeadsGroup(req.user.id, leadIds, group);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating leads group', error: error.message });
    }
});

// Bulk import leads (from CSV upload in Campaign wizard)
router.post('/bulk', authMiddleware, async (req, res) => {
    try {
        const { leads } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ message: 'No leads provided' });
        }
        const result = await storage.bulkFindOrCreateLeads(req.user.id, leads);
        res.status(201).json({ 
            ids: result.ids, 
            count: result.leads.length,
            newCount: result.newCount,
            matchedCount: result.matchedCount
        });
    } catch (error) {
        if (error.code === 11000 || (error.writeErrors && error.writeErrors.some(e => e.code === 11000))) {
            return res.status(400).json({ 
                message: 'Some leads were skipped because their email addresses already exist in your list.',
                error: 'Duplicate leads detected'
            });
        }
        res.status(500).json({ message: 'Error bulk-importing leads', error: error.message });
    }
});

// Create a new lead
router.post('/', authMiddleware, async (req, res) => {
    try {
        const lead = await storage.addLead(req.user.id, req.body);
        res.status(201).json(lead);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'A lead with this email address already exists in your list.' });
        }
        res.status(500).json({ message: 'Error creating lead', error: error.message });
    }
});

// Update a lead
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const lead = await storage.updateLead(req.user.id, req.params.id, req.body);
        if (!lead) return res.status(404).json({ message: 'Lead not found' });
        res.json(lead);
    } catch (error) {
        res.status(500).json({ message: 'Error updating lead', error: error.message });
    }
});

// Delete a lead
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const lead = await storage.deleteLead(req.user.id, req.params.id);
        if (!lead) return res.status(404).json({ message: 'Lead not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting lead', error: error.message });
    }
});

module.exports = router;
