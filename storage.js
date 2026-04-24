const Account = require('./models/Account');
const Lead = require('./models/Lead');
const Template = require('./models/Template');
const Campaign = require('./models/Campaign');

const getAccounts = async (userId) => {
    return await Account.find({ userId }).sort({ createdAt: -1 });
};

const addAccount = async (userId, accountData) => {
    // Use email + userId as unique identifier
    return await Account.findOneAndUpdate(
        { email: accountData.email, userId: userId },
        { ...accountData, userId, createdAt: new Date() },
        { upsert: true, new: true }
    );
};

const deleteAccount = async (userId, id) => {
    return await Account.findOneAndDelete({ _id: id, userId: userId });
};

const getLeads = async (userId, filters = {}) => {
    const query = { userId };
    if (filters.status && filters.status !== 'all') query.status = filters.status;
    if (filters.industry && filters.industry !== 'all') query.industry = filters.industry;
    if (filters.group && filters.group !== 'all') query.group = filters.group;
    if (filters.search) {
        query.$or = [
            { fullName: { $regex: filters.search, $options: 'i' } },
            { email: { $regex: filters.search, $options: 'i' } },
            { company: { $regex: filters.search, $options: 'i' } }
        ];
    }
    
    let sort = { createdAt: -1 };
    if (filters.sort === 'name_asc') sort = { fullName: 1 };
    if (filters.sort === 'name_desc') sort = { fullName: -1 };
    if (filters.sort === 'newest') sort = { createdAt: -1 };
    if (filters.sort === 'oldest') sort = { createdAt: 1 };

    const leads = await Lead.find(query).sort(sort).lean();

    // Enrich with queue status
    const activeCampaigns = await Campaign.find({ userId, status: 'active' }).lean();
    const leadsInQueue = new Set();
    
    for (const campaign of activeCampaigns) {
        if (!campaign.leadStates) continue;
        for (const ls of campaign.leadStates) {
            if (!ls.completed && !ls.isPaused) {
                leadsInQueue.add(ls.leadId.toString());
            }
        }
    }

    return leads.map(l => ({
        ...l,
        inQueue: leadsInQueue.has(l._id.toString())
    }));
};


const addLead = async (userId, leadData) => {
    const lead = new Lead({ ...leadData, userId });
    return await lead.save();
};

const bulkAddLeads = async (userId, leadsData) => {
    const docs = leadsData.map(l => ({ ...l, userId }));
    return await Lead.insertMany(docs, { ordered: false }); // ordered:false so partial success works
};

const bulkFindOrCreateLeads = async (userId, leadsData) => {
    const bulkOps = leadsData.map(lead => ({
        updateOne: {
            filter: { userId, email: lead.email },
            update: { $set: { ...lead, userId } },
            upsert: true
        }
    }));
    
    const result = await Lead.bulkWrite(bulkOps);
    
    // Fetch all leads by email to return IDs for the campaign
    const emails = leadsData.map(l => l.email);
    const leads = await Lead.find({ userId, email: { $in: emails } }).select('_id email').lean();
    
    return {
        leads,
        newCount: result.upsertedCount,
        matchedCount: result.matchedCount,
        ids: leads.map(l => l._id)
    };
};

const updateLead = async (userId, leadId, leadData) => {
    return await Lead.findOneAndUpdate(
        { _id: leadId, userId: userId },
        { ...leadData },
        { new: true }
    );
};

const deleteLead = async (userId, leadId) => {
    return await Lead.findOneAndDelete({ _id: leadId, userId: userId });
};

const deleteLeads = async (userId, leadIds) => {
    return await Lead.deleteMany({ _id: { $in: leadIds }, userId: userId });
};

const bulkUpdateLeadsGroup = async (userId, leadIds, group) => {
    return await Lead.updateMany(
        { _id: { $in: leadIds }, userId: userId },
        { group }
    );
};

const getTemplates = async (userId) => {
    return await Template.find({ userId }).sort({ createdAt: -1 });
};

const addTemplate = async (userId, templateData) => {
    const template = new Template({ ...templateData, userId });
    return await template.save();
};

const updateTemplate = async (userId, templateId, templateData) => {
    return await Template.findOneAndUpdate(
        { _id: templateId, userId: userId },
        { ...templateData },
        { new: true }
    );
};

const deleteTemplate = async (userId, templateId) => {
    return await Template.findOneAndDelete({ _id: templateId, userId: userId });
};

const getCampaigns = async (userId) => {
    return await Campaign.find({ userId }).sort({ createdAt: -1 });
};

const getActiveQueue = async (userId) => {
    // Finds all campaigns for the user to show full history until deleted
    const campaigns = await Campaign.find({ userId }).populate('leadStates.leadId').lean();
    let queue = [];
    const now = new Date();
    
    for (const campaign of campaigns) {
        if (!campaign.leadStates) continue;
        
        for (const ls of campaign.leadStates) {
            // Include both active and completed leads
            const lead = ls.leadId;
            if (!lead || lead.status === 'unsubscribed') continue;
            
            const currentStep = campaign.sequence && campaign.sequence[ls.currentStepIndex];
            
            // Calculate timing and status
            let nextSendAt = null;
            let status = "Waiting";

            if (ls.completed) {
                status = "Completed";
                nextSendAt = "Done";
            } else if (!currentStep) {
                // Should not happen if not completed, but as a fallback:
                status = "Finished";
                nextSendAt = "N/A";
            } else if (!ls.startedAt) {
                if (ls.currentStepIndex === 0) {
                    status = "Due";
                    nextSendAt = "Now";
                }
            } else {
                const daysOffset = Math.max(0, currentStep.day - 1);
                const requiredMs = daysOffset * 24 * 60 * 60 * 1000;
                const scheduledTime = new Date(new Date(ls.startedAt).getTime() + requiredMs);
                
                if (now >= scheduledTime) {
                    status = "Due";
                    nextSendAt = "Scheduled";
                } else {
                    status = "Waiting";
                    nextSendAt = scheduledTime;
                }
            }

            if (!ls.completed && ls.isPaused) {
                status = "Paused";
                nextSendAt = "Suspended";
            }
            
            queue.push({
                leadId: lead._id,
                email: lead.email,
                name: lead.fullName || 'Unknown',
                company: lead.company || '',
                campaignId: campaign._id,
                campaignName: campaign.name,
                stepIndex: ls.completed ? campaign.sequence.length : ls.currentStepIndex + 1,
                day: currentStep ? currentStep.day : (campaign.sequence[campaign.sequence.length - 1]?.day || null),
                totalSteps: campaign.sequence ? campaign.sequence.length : 1,
                startedAt: ls.startedAt,
                lastProcessedAt: ls.lastProcessedAt,
                nextSendAt: nextSendAt,
                status: status,
                isPaused: ls.isPaused || false,
                isCompleted: ls.completed || false,
                hasReplied: ls.hasReplied || false,
                replyContent: ls.replyContent || null,
                repliedAt: ls.repliedAt || null
            });
        }
    }
    
    return queue;
};

const toggleLeadPause = async (userId, campaignId, leadId) => {
    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaign) return null;

    const leadState = campaign.leadStates.find(ls => ls.leadId.toString() === leadId.toString());
    if (leadState) {
        leadState.isPaused = !leadState.isPaused;
        await campaign.save();
        return leadState;
    }
    return null;
};

const stopLeadSequence = async (userId, campaignId, leadId) => {
    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaign) return null;

    const leadState = campaign.leadStates.find(ls => ls.leadId.toString() === leadId.toString());
    if (leadState) {
        leadState.completed = true;
        await campaign.save();
        return leadState;
    }
    return null;
};

const addCampaign = async (userId, campaignData) => {
    // Convert leadIds into leadStates
    if (campaignData.leadIds && Array.isArray(campaignData.leadIds)) {
        campaignData.leadStates = campaignData.leadIds.map(id => ({
            leadId: id,
            currentStepIndex: 0,
            startedAt: null,
            lastProcessedAt: null,
            completed: false
        }));
    }
    const campaign = new Campaign({ ...campaignData, userId });
    return await campaign.save();
};

const updateCampaign = async (userId, campaignId, campaignData) => {
    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    if (!campaign) return null;

    // Handle lead synchronization if leadIds are updated
    if (campaignData.leadIds && Array.isArray(campaignData.leadIds)) {
        const existingLeadStates = campaign.leadStates || [];
        const newLeadStates = [];

        for (const leadId of campaignData.leadIds) {
            const existing = existingLeadStates.find(ls => ls.leadId.toString() === leadId.toString());
            if (existing) {
                newLeadStates.push(existing);
            } else {
                newLeadStates.push({
                    leadId: leadId,
                    currentStepIndex: 0,
                    startedAt: null,
                    lastProcessedAt: null,
                    completed: false,
                    isPaused: false
                });
            }
        }
        campaignData.leadStates = newLeadStates;
    }

    // Apply other updates
    Object.assign(campaign, campaignData);
    return await campaign.save();
};

const deleteCampaign = async (userId, campaignId) => {
    return await Campaign.findOneAndDelete({ _id: campaignId, userId: userId });
};

const deleteCampaigns = async (userId, campaignIds) => {
    return await Campaign.deleteMany({ _id: { $in: campaignIds }, userId: userId });
};

const updateCampaignStatus = async (userId, campaignIds, status) => {
    return await Campaign.updateMany(
        { _id: { $in: campaignIds }, userId: userId },
        { status }
    );
};

module.exports = {
    getAccounts,
    addAccount,
    deleteAccount,
    getLeads,
    addLead,
    bulkAddLeads,
    updateLead,
    deleteLead,
    deleteLeads,
    getTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getCampaigns,
    getActiveQueue,
    toggleLeadPause,
    stopLeadSequence,
    addCampaign,
    updateCampaign,
    deleteCampaign,
    deleteCampaigns,
    updateCampaignStatus,
    bulkUpdateLeadsGroup,
    bulkFindOrCreateLeads,
};
