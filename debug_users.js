require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function debug() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/newlovable');
    const users = await User.find();
    console.log('User IDs:', users.map(u => ({ id: u._id.toString(), email: u.email })));
    process.exit(0);
}

debug();
