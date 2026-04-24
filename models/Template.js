const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
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
    subject: {
        type: String,
        required: true,
        trim: true
    },
    body: {
        type: String,
        required: true
    },
    backgroundImage: {
        type: String,
        trim: true
    },
    backgroundColor: {
        type: String,
        default: '#ffffff'
    },
    lastUsed: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster searching by name and user
templateSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('Template', templateSchema);
