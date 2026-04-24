const express = require('express');
const storage = require('../storage');
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// Upload image for template
router.post('/upload', authMiddleware, upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        res.json({ url: fileUrl });
    } catch (error) {
        res.status(500).json({ message: 'Error uploading file', error: error.message });
    }
});

// Get all templates for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const templates = await storage.getTemplates(req.user.id);
        res.json(templates);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
});

// Create a new template
router.post('/', authMiddleware, async (req, res) => {
    try {
        const template = await storage.addTemplate(req.user.id, req.body);
        res.status(201).json(template);
    } catch (error) {
        res.status(500).json({ message: 'Error creating template', error: error.message });
    }
});

// Update a template
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const template = await storage.updateTemplate(req.user.id, req.params.id, req.body);
        if (!template) return res.status(404).json({ message: 'Template not found' });
        res.json(template);
    } catch (error) {
        res.status(500).json({ message: 'Error updating template', error: error.message });
    }
});

// Delete a template
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const template = await storage.deleteTemplate(req.user.id, req.params.id);
        if (!template) return res.status(404).json({ message: 'Template not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting template', error: error.message });
    }
});

module.exports = router;
