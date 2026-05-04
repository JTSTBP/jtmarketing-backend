require('dotenv').config();
const mongoose = require('mongoose');
const Template = require('./models/Template');
const User = require('./models/User');

async function debug() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/newlovable');
    const template = await Template.findOne().populate('userId');
    console.log('Template Sample:', JSON.stringify(template, null, 2));
    process.exit(0);
}

debug();
