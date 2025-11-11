const { spawn } = require('child_process');
const { createGitHubIssue, fetchRepoReadme } = require('../services/github');
const { convertMarkdownToDiscord } = require('../utils/embed');

// Conversation storage for Claude (if needed in future)
const conversationHistory = new Map();

/**
 * Ask Claude CLI a question
 */
async function askClaude(question, channelId) {
    return new Promise((resolve, reject) => {
        const output = [];
        const errors = [];

        // Build prompt with context
        const contextPrompt = `[Context: NeonLadder - a 2.5D roguelite platformer Unity game]
You are a Unity game development expert helping with NeonLadder development. Provide concise, actionable advice.

${question}`;

        // Spawn claude CLI process
        const claudeProcess = spawn('claude', [contextPrompt], {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Collect stdout
        claudeProcess.stdout.on('data', (data) => {
            output.push(data.toString());
        });

        // Collect stderr
        claudeProcess.stderr.on('data', (data) => {
            errors.push(data.toString());
        });

        // Handle process completion
        claudeProcess.on('close', (code) => {
            if (code === 0) {
                let cleanOutput = output.join('')
                    .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
                    .replace(/[\r\n]+/g, '\n')
                    .trim();

                resolve(cleanOutput || 'Claude responded but produced no output.');
            } else {
                reject(new Error(`Claude CLI exited with code ${code}: ${errors.join('')}`));
            }
        });

        // Handle process errors
        claudeProcess.on('error', (error) => {
            reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
        });

        // Timeout after 2 minutes
        setTimeout(() => {
            claudeProcess.kill();
            reject(new Error('Claude CLI timeout (2 minutes)'));
        }, 120000);
    });
}

/**
 * Determine which repo based on channel name
 */
function getRepoFromChannel(channelName) {
    const prefix = channelName.split('-')[0];
    const envKey = `${prefix.toUpperCase()}_REPO`;
    return process.env[envKey] || null;
}

/**
 * Determine issue type from channel name
 */
function getIssueTypeFromChannel(channelName) {
    if (channelName.includes('feature-request')) {
        return 'feature';
    } else if (channelName.includes('bug-report')) {
        return 'bug';
    }
    return null;
}

/**
 * Handle Discord message events (bot mentions, etc.)
 */
async function handleMessage(message) {
    // Ignore bot messages
    if (message.author.bot) return;

    const client = message.client;

    // Handle bot mentions
    if (message.mentions.has(client.user)) {
        const channelName = message.channel.name;
        const content = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
        const repo = getRepoFromChannel(channelName);
        const issueType = getIssueTypeFromChannel(channelName);

        // Handle README request
        if (content.includes('readme')) {
            let targetRepo = repo;

            const repoMatch = content.match(/readme\s+(\S+)/i);
            if (repoMatch) {
                targetRepo = repoMatch[1];
            }

            if (!targetRepo) {
                return message.reply(
                    '❌ Please specify a repository.\nUsage: `@bot readme <repo-name>`\nExample: `@bot readme NeonLadder`'
                );
            }

            try {
                await message.react('⏳');

                const readme = await fetchRepoReadme(targetRepo);
                const discordReadme = convertMarkdownToDiscord(readme);

                const MAX_LENGTH = 1900;

                if (discordReadme.length <= MAX_LENGTH) {
                    await message.reactions.removeAll();
                    await message.reply(`📄 **README for ${targetRepo}**\n\n${discordReadme}`);
                } else {
                    await message.reactions.removeAll();
                    await message.reply(`📄 **README for ${targetRepo}** (Part 1)`);

                    const chunks = [];
                    for (let i = 0; i < discordReadme.length; i += MAX_LENGTH) {
                        chunks.push(discordReadme.substring(i, i + MAX_LENGTH));
                    }

                    for (let i = 0; i < chunks.length && i < 5; i++) {
                        await message.channel.send(chunks[i]);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    if (chunks.length > 5) {
                        const owner = process.env.GITHUB_OWNER || process.env.GITHUB_REPO?.split('/')[0] || 'owner';
                        await message.channel.send(
                            `\n... README is too long. View full README: https://github.com/${owner}/${targetRepo}#readme`
                        );
                    }
                }

                console.log(`Fetched README for ${targetRepo} in ${channelName}`);
            } catch (error) {
                await message.reactions.removeAll();
                await message.react('❌');
                await message.reply(
                    `❌ Could not fetch README for "${targetRepo}".\nMake sure the repository exists and has a README file.`
                );
            }
            return;
        }

        // Handle issue creation in feature-request and bug-report channels
        if (repo && issueType) {
            const originalContent = message.content.replace(/<@!?\d+>/g, '').trim();

            if (originalContent.length < 10) {
                await message.reply('Please provide more details for the issue. Format: @bot [issue title/description]');
                return;
            }

            const lines = originalContent.split('\n');
            const title = lines[0].substring(0, 100);
            const body = lines.length > 1 ? lines.slice(1).join('\n') : originalContent;

            try {
                await message.react('⏳');

                const issue = await createGitHubIssue(
                    repo,
                    title,
                    body,
                    issueType,
                    message.author.tag
                );

                await message.reactions.removeAll();
                await message.react('✅');

                await message.reply(
                    `✅ Created GitHub ${issueType} issue: ${issue.html_url}\n**#${issue.number}**: ${issue.title}`
                );

                console.log(`Created issue #${issue.number} in ${repo} from Discord`);
            } catch (error) {
                await message.reactions.removeAll();
                await message.react('❌');
                await message.reply(`❌ Error creating GitHub issue: ${error.message}`);
            }
            return;
        }

        // For all other bot mentions, direct users to use slash commands
        await message.reply(
            '💡 Please use slash commands to interact with me:\n' +
            '• `/askgpt` - Ask GPT a question\n' +
            '• `/feature-request` - Submit a feature request\n' +
            '• `/readme` - Fetch a repository README\n' +
            '• `/help` - See all available commands'
        );
        return;
    }
}

/**
 * Clear conversation history for a channel
 */
function clearConversation(channelId) {
    conversationHistory.delete(channelId);
    console.log(`Conversation cleared for channel ${channelId}`);
}

module.exports = {
    handleMessage,
    clearConversation
};
