const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['active', 'paused', 'draft'],
        default: 'active'
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },
    // Audience
    leadIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead'
    }],
    leadStates: [{
        leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
        currentStepIndex: { type: Number, default: 0 },
        startedAt: { type: Date, default: null },
        lastProcessedAt: { type: Date, default: null },
        completed: { type: Boolean, default: false },
        isPaused: { type: Boolean, default: false },
        hasReplied: { type: Boolean, default: false },
        replyContent: { type: String, default: null },
        repliedAt: { type: Date, default: null },
        lastLeadMessageId: { type: String, default: null }
    }],
    // Content — either a saved template OR custom subject/body
    sequence: [{
        day: { type: Number, required: true, default: 1 },
        templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', default: null },
        customSubject: { type: String, default: '' },
        customBody: { type: String, default: '' },
        customBackgroundImage: { type: String, default: '' },
        customBackgroundColor: { type: String, default: '#ffffff' }
    }],
    // Metrics
    metrics: {
        sent:    { type: Number, default: 0 },
        opened:  { type: Number, default: 0 },
        replied: { type: Number, default: 0 }
    },
    // Send settings
    settings: {
        dailyLimit:   { type: Number, default: 50 },
        delayMinutes: { type: Number, default: 2 }
    },
    lastRunAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster querying per user
campaignSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
