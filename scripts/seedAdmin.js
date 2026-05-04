require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newlovable');
        console.log('Connected to DB');

        const existingAdmin = await User.findOne({ email: 'gayathri@gmail.com' });
        if (existingAdmin) {
            console.log('Admin already exists. Updating role to admin...');
            existingAdmin.role = 'admin';
            existingAdmin.password = '123456';
            await existingAdmin.save();
            console.log('Admin user updated.');
        } else {
            const adminUser = new User({
                name: 'Admin Gayathri',
                email: 'gayathri@gmail.com',
                password: '123456',
                role: 'admin'
            });
            await adminUser.save();
            console.log('Admin user created successfully.');
        }

        mongoose.connection.close();
    } catch (err) {
        console.error('Error seeding admin:', err);
        process.exit(1);
    }
};

seedAdmin();
