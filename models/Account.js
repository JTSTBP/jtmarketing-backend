const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    provider: { type: String, enum: ['google', 'microsoft'], required: true },
    tokens: { type: Object, required: true },
    dailyLimit: { type: Number, default: 2000 },
    status: { type: String, default: 'active' },
    lastReplyCheckAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', accountSchema);
