const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    campaignId: { type: String, default: null },
    email: { type: String, required: true },
    fullName: { type: String, required: true },
    company: { type: String },
    linkedinUrl: { type: String },
    industry: { type: String },
    status: { type: String, default: 'active' },
    group: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

leadSchema.index({ userId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Lead', leadSchema);
