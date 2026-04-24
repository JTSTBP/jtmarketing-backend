const fs = require('fs');
const path = require('path');
const newWorker = `const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Campaign = require('./models/Campaign');
const Account = require('./models/Account');
const Lead = require('./models/Lead');
const emailService = require('./services/emailService');

const WORKER_INTERVAL_MS = 60 * 1000;
let isRunning = false;

const startWorker = () => {
    console.log('[Worker] Initializing Background Campaign Processor...');
    setInterval(processCampaigns, WORKER_INTERVAL_MS);
    processCampaigns();
};

const processCampaigns = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
        // --- REPLY DETECTION PHASE ---
        await checkAllReplies();

        // --- SENDING PHASE ---
        const activeCampaigns = await Campaign.find({ status: 'active' }).populate('accountId');

        for (const campaign of activeCampaigns) {
            // Check if all leads are completed
            if (campaign.leadStates && campaign.leadStates.every(ls => ls.completed)) {
                campaign.status = 'paused';
                await campaign.save();
                console.log(\`[Worker] Campaign "\${campaign.name}" finished processing all leads. Automatically paused.\`);
                continue;
            }

            // Fallback for legacy campaigns without leadStates/sequence
            if (!campaign.sequence || campaign.sequence.length === 0) {
                console.warn(\`[Worker] Skipping Campaign "\${campaign.name}": No sequence found (Legacy format unsupported).\`);
                continue;
            }

            const now = new Date();
            let madeChanges = false;

            const account = campaign.accountId;
            if (!account || account.status !== 'active') {
                console.error(\`[Worker] Ignoring Campaign "\${campaign.name}": Assigned Account missing or inactive.\`);
                continue;
            }

            for(let i = 0; i < campaign.leadStates.length; i++) {
                const ls = campaign.leadStates[i];
                if (ls.completed || ls.isPaused) continue;

                // Check interval limit if this campaign has recent runs at the GLOBAL level
                if (campaign.lastRunAt) {
                    const diffMins = (now.getTime() - new Date(campaign.lastRunAt).getTime()) / 60000;
                    if (diffMins < (campaign.settings.delayMinutes || 1)) {
                        break; // Stop processing this campaign entirely for this tick limit
                    }
                }

                // Identify the step this lead is on
                const stepIndex = ls.currentStepIndex;
                if (stepIndex >= campaign.sequence.length) {
                    ls.completed = true;
                    madeChanges = true;
                    continue;
                }

                const currentStep = campaign.sequence[stepIndex];
                
                // Logic for drip timing
                if (ls.startedAt) {
                    const daysOffset = Math.max(0, currentStep.day - 1);
                    const requiredMs = daysOffset * 24 * 60 * 60 * 1000;
                    if (now.getTime() - new Date(ls.startedAt).getTime() < requiredMs) {
                        continue; // Not time yet for this lead
                    }
                }

                // It's time to send!
                const leadId = ls.leadId;
                const lead = await Lead.findById(leadId);
                
                // CRITICAL: Stop sending if lead is unsubscribed OR has responded
                if (!lead || lead.status === 'unsubscribed' || lead.status === 'responded') {
                    ls.completed = true;
                    madeChanges = true;
                    continue;
                }

                const subjectTemplate = currentStep.customSubject || '';
                const bodyTemplate = currentStep.customBody || '';

                const subject = subjectTemplate
                    .replace(/\{\{fullName\}\}/gi, lead.fullName || '')
                    .replace(/\{\{leadName\}\}/gi, lead.fullName || '') // Fallback for existing templates
                    .replace(/\{\{name\}\}/gi, lead.fullName || '')
                    .replace(/\{\{company\}\}/gi, lead.company || '')
                    .replace(/\{\{industry\}\}/gi, lead.industry || '')
                    .replace(/\{\{email\}\}/gi, lead.email || '')
                    .replace(/\{\{linkedinUrl\}\}/gi, lead.linkedinUrl || '')
                    .replace(/\{\{group\}\}/gi, lead.group || '');
                
                const rawBody = bodyTemplate
                    .replace(/\{\{fullName\}\}/gi, lead.fullName || '')
                    .replace(/\{\{leadName\}\}/gi, lead.fullName || '') // Fallback for existing templates
                    .replace(/\{\{name\}\}/gi, lead.fullName || '')
                    .replace(/\{\{company\}\}/gi, lead.company || '')
                    .replace(/\{\{industry\}\}/gi, lead.industry || '')
                    .replace(/\{\{email\}\}/gi, lead.email || '')
                    .replace(/\{\{linkedinUrl\}\}/gi, lead.linkedinUrl || '')
                    .replace(/\{\{group\}\}/gi, lead.group || '');

                // Parse markdown images and newlines exactly like the Template Editor
                const parsedBody = rawBody.split(/(!\[.*?\]\(.*?\))/g).map(part => {
                    const match = part.match(/!\[.*?\]\((.*?)\)/);
                    if (match) return \`<img src="\${match[1]}" alt="Inserted" style="width: 100%; height: auto; border-radius: 20px; margin: 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />\`;
                    // Convert plain text newlines to <br> if no HTML tags are present or as a fallback
                    return part.includes('<') ? part : part.replace(/\n/g, '<br/>');
                }).join('');

                // Detect if the body is from a Template or contains HTML
                const isFromTemplate = !!currentStep.templateId;
                const containsHtml = /<[a-z][\s\S]*>/i.test(parsedBody);
                const isHtmlBody = isFromTemplate || containsHtml;

                let attachments = [];
                let bgUrl = currentStep.customBackgroundImage;

                if (bgUrl && bgUrl.includes('/uploads/')) {
                    const filename = bgUrl.split('/uploads/')[1];
                    const localPath = path.join(__dirname, 'uploads', filename);
                    if (fs.existsSync(localPath)) {
                        const cid = 'bg_img_' + Date.now() + '@jtcrm';
                        const base64Data = fs.readFileSync(localPath, { encoding: 'base64' });
                        attachments.push({ filename: filename, base64Data: base64Data, cid: cid });
                        bgUrl = 'cid:' + cid;
                    }
                }

                // Process inline images
                let processedBody = parsedBody;
                const imgRegex = /<img[^>]+src="([^">]+)"/gi;
                let match;
                while ((match = imgRegex.exec(parsedBody)) !== null) {
                    const originalSrc = match[1];
                    if (originalSrc.includes('/uploads/')) {
                        const filename = originalSrc.split('/uploads/')[1];
                        const localPath = path.join(__dirname, 'uploads', filename);
                        if (fs.existsSync(localPath)) {
                            const cid = 'img_' + Date.now() + '_' + Math.floor(Math.random()*1000) + '@jtcrm';
                            const base64Data = fs.readFileSync(localPath, { encoding: 'base64' });
                            attachments.push({ filename: filename, base64Data: base64Data, cid: cid });
                            processedBody = processedBody.replace(originalSrc, 'cid:' + cid);
                        }
                    }
                }

                const unsubscribeUrl = \`\${process.env.API_URL || 'http://localhost:5000'}/api/public/unsubscribe/\${lead._id}\`;
                const unsubscribeHtml = \`
                    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-family: system-ui, -apple-system, sans-serif, Arial;">
                        <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                            Don't want to receive these emails? <a href="\${unsubscribeUrl}" style="color: #6366f1; text-decoration: underline;">Unsubscribe</a>
                        </p>
                    </div>
                \`;

                let bodyHtml;

                if (isHtmlBody) {
                    // --- Rich HTML body (from Template Editor) ---
                    // Use the same backgroundColor the TemplateEditor preview shows,
                    // so the sent email matches the preview exactly.
                    const bgColor = currentStep.customBackgroundColor || '#ffffff';
                    const contentWithUnsubscribe = processedBody.toLowerCase().includes('</body>') 
                        ? processedBody.replace(/<\/body>/i, \`\${unsubscribeHtml}</body>\`)
                        : processedBody + unsubscribeHtml;

                    bodyHtml = \`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8" />
                            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                            <style>
                                img { max-width: 100%; height: auto; border-radius: 12px; margin: 16px 0; }
                                p { margin-top: 0; margin-bottom: 16px; }
                            </style>
                        </head>
                        <body style="margin:0; padding:0; background-color:\${bgColor};">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:\${bgColor}; min-height:100vh;">
                                <tr>
                                    <td align="center" style="padding: 40px 20px; background-color:\${bgColor};">
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
                                            <tr>
                                                <td style="padding: 40px; font-family: system-ui, -apple-system, sans-serif, Arial; color: #334155; font-size: 16px; line-height: 1.6; text-align: left;">
                                                    \${contentWithUnsubscribe}
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </body>
                        </html>
                    \`;
                } else {
                    // --- Plain-text body (typed directly in campaign wizard) ---
                    // Convert newlines to <br/> and wrap in a presentational table.
                    const plainHtml = processedBody;

                    if (bgUrl) {
                        bodyHtml = \`
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc;">
                                <tr>
                                    <td align="center" background="\${bgUrl}" style="background: url('\${bgUrl}') center/cover no-repeat; padding: 50px 20px;">
                                        <!--[if gte mso 9]>
                                        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
                                        <v:fill type="tile" src="\${bgUrl}" />
                                        <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
                                        <![endif]-->
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background-color: rgba(255, 255, 255, 0.9); border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                                            <tr>
                                                <td style="padding: 40px; font-family: system-ui, -apple-system, sans-serif, Arial; color: #334155; font-size: 16px; line-height: 1.6; text-align: left;">
                                                    \${plainHtml}
                                                    \${unsubscribeHtml}
                                                </td>
                                            </tr>
                                        </table>
                                        <!--[if gte mso 9]>
                                        </v:textbox>
                                        </v:rect>
                                        <![endif]-->
                                    </td>
                                </tr>
                            </table>
                        \`;
                    } else {
                        bodyHtml = \`
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding: 20px;">
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto;">
                                            <tr>
                                                <td style="font-family: system-ui, -apple-system, sans-serif, Arial; color: #334155; font-size: 16px; line-height: 1.6; text-align: left;">
                                                    \${plainHtml}
                                                    \${unsubscribeHtml}
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        \`;
                    }
                }

                console.log(\`[Worker] Dispatching Campaign "\${campaign.name}" (Step \${stepIndex + 1}) to \${lead.email}...\`);
                try {
                    await emailService.sendEmail(account, lead.email, subject, bodyHtml, attachments);
                    
                    campaign.metrics.sent += 1;
                    if (stepIndex === 0) ls.startedAt = now;
                    ls.lastProcessedAt = now;
                    ls.currentStepIndex += 1;
                    if (ls.currentStepIndex >= campaign.sequence.length) {
                        ls.completed = true;
                    }
                    campaign.lastRunAt = now;
                    madeChanges = true;
                    break; // Only process one lead per tick to respect rate limits
                } catch (emailErr) {
                    console.error(\`[Worker] Failed dispatch for campaign [\${campaign.name}] to \${lead.email}:\`, emailErr.message);
                    break; 
                }
            }

            if (madeChanges) {
                await campaign.save();
            }
        }
    } catch (error) {
        console.error('[Worker] Fatal error during iteration:', error);
    } finally {
        isRunning = false;
    }
};

const checkAllReplies = async () => {
    try {
        // Find all unique accounts
        const accounts = await Account.find({ status: 'active' });
        
        for (const account of accounts) {
            console.log(\`[Worker] Checking for replies in \${account.email} (Since: \${account.lastReplyCheckAt || 'All Time'})...\`);
            
            const replies = await emailService.fetchRecentReplies(account, account.lastReplyCheckAt);
            
            // Update last check time immediately to avoid double processing if fetch succeeds
            account.lastReplyCheckAt = new Date();
            await account.save();

            if (!replies || replies.length === 0) continue;

            for (const reply of replies) {
                // 1. Find the lead globally by email (for this user)
                const lead = await Lead.findOne({ 
                    email: reply.email.toLowerCase(),
                    userId: account.userId 
                });

                if (!lead) continue;

                console.log(\`[Worker] Match found! Lead \${reply.email} responded to \${account.email}\`);

                // 2. Mark lead status as 'responded' globally
                if (lead.status === 'active') {
                    lead.status = 'responded';
                    await lead.save();
                }

                // 3. Stop ALL active campaigns for this lead for this user
                const campaignsToUpdate = await Campaign.find({
                    userId: account.userId,
                    'leadStates': {
                        \$elemMatch: {
                            leadId: lead._id,
                            completed: false
                        }
                    }
                });

                for (const campaign of campaignsToUpdate) {
                    const ls = campaign.leadStates.find(s => s.leadId.toString() === lead._id.toString());
                    if (ls && !ls.completed) {
                        console.log(\`[Worker] Stopping Campaign "\${campaign.name}" for Lead \${lead.email}\`);
                        ls.hasReplied = true;
                        ls.replyContent = reply.snippet;
                        ls.repliedAt = reply.date;
                        ls.completed = true; 
                        ls.lastLeadMessageId = reply.id;
                        
                        campaign.metrics.replied = (campaign.metrics.replied || 0) + 1;
                        await campaign.save();
                    }
                }

                // Mark as read in provider to signify processing
                await emailService.markAsRead(account, reply.id);
            }
        }
    } catch (err) {
        if (err.message?.includes('Insufficient Permissions') || err.message?.includes('scope')) {
            console.error('[Worker] CRITICAL: Permission error. Please reconnect your email accounts to enable response tracking.');
        } else {
            console.error('[Worker] Error during reply detection:', err.message);
        }
    }
};

module.exports = { startWorker };`;

fs.writeFileSync('worker.js', newWorker);
