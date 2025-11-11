const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { setDiscordClient, startWebhookServer } = require('./webhooks');
const {
  addRepoCommand,
  removeRepoCommand,
  listReposCommand,
  addRoleCommand,
  getRepoFromChannel,
  getIssueTypeFromChannel,
  createGitHubIssue,
  fetchRepoReadme,
  convertMarkdownToDiscord,
  helpCommand,
} = require('./commands');
require('dotenv').config();

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Conversation storage for Claude
const conversationHistory = new Map();

// Claude CLI integration
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

// OpenAI integration (keeping existing functionality)
async function askGPT(question) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-5-nano',
            messages: [
                {
                    role: 'system',
                    content: 'You are a Unity game development expert helping with NeonLadder, a 2.5D roguelite platformer. Provide concise, actionable advice.'
                },
                {
                    role: 'user',
                    content: question
                }
            ],
            max_tokens: 500,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API Error:', error);
        return 'Sorry, I could not connect to GPT right now. Please try again later.';
    }
}

// Clear conversation history
function clearConversation(channelId) {
    conversationHistory.delete(channelId);
    console.log(`Conversation cleared for channel ${channelId}`);
}

// Check if user has admin privileges (Founder, Administrator role, or Discord Admin permission)
function isAdmin(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    const adminRoles = ['Founder', 'Administrator'];
    return member.roles.cache.some(role => adminRoles.includes(role.name));
}

// Detect repository name from channel's parent category
function detectRepoFromChannel(channel) {
    // Get the parent category
    const parent = channel.parent;

    if (!parent) {
        return null;
    }

    // Extract repo name from category, removing all emojis
    // (e.g., "📦 QiFlow" -> "QiFlow", "🔒 QiFlow" -> "QiFlow")
    const categoryName = parent.name;
    const repoName = categoryName
        .replace(/[\u{1F000}-\u{1F9FF}]/gu, '') // Remove emojis
        .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Remove misc symbols
        .trim();

    return repoName;
}

// Fetch and display README using gh CLI
async function fetchAndDisplayReadme(interaction, repoName) {
    const owner = process.env.GITHUB_OWNER || 'irsiksoftware';
    const fullRepo = `${owner}/${repoName}`;

    try {
        await interaction.deferReply();

        // Use Octokit to fetch README (works with private repos)
        const { Octokit } = require('@octokit/rest');
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        const response = await octokit.rest.repos.getReadme({
            owner: owner,
            repo: repoName,
        });

        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');

        if (!content || content.trim() === '') {
            throw new Error('No README content returned');
        }

        // Convert markdown to Discord-friendly format
        let discord = content;
        discord = discord.replace(/^### (.*$)/gim, '**$1**');
        discord = discord.replace(/^## (.*$)/gim, '**__$1__**');
        discord = discord.replace(/^# (.*$)/gim, '**__$1__**');
        discord = discord.replace(/<!--[\s\S]*?-->/g, '');
        discord = discord.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]($2)');
        discord = discord.trim();

        const MAX_LENGTH = 1900;

        if (discord.length <= MAX_LENGTH) {
            await interaction.editReply(`📄 **README for ${fullRepo}**\n\n${discord}`);
        } else {
            await interaction.editReply(`📄 **README for ${fullRepo}** (Part 1)`);

            const chunks = [];
            for (let i = 0; i < discord.length; i += MAX_LENGTH) {
                chunks.push(discord.substring(i, i + MAX_LENGTH));
            }

            for (let i = 0; i < chunks.length && i < 5; i++) {
                await interaction.followUp(chunks[i]);
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (chunks.length > 5) {
                await interaction.followUp(
                    `\n... README is too long. View full README: https://github.com/${fullRepo}/blob/main/README.md`
                );
            }
        }

        console.log(`Fetched README for ${fullRepo} via gh CLI`);
    } catch (error) {
        console.error(`Error fetching README for ${repoName}:`, error.message);
        await interaction.editReply(
            `❌ Could not fetch README for "${repoName}".\nMake sure the repository exists at https://github.com/${owner}/${repoName}/blob/main/README.md and you have access to it.`
        );
    }
}

// GitHub integration
async function getGitHubIssues() {
    try {
        const response = await axios.get(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues?labels=PBI&state=open&sort=created&direction=desc&per_page=5`, {
            headers: {
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('GitHub API Error:', error);
        return [];
    }
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('ask-claude')
        .setDescription('Ask Claude AI about software development')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Your question for Claude')
                .setRequired(true)
        ),

    // Disabled - requires OpenAI API key
    // new SlashCommandBuilder()
    //     .setName('askgpt')
    //     .setDescription('Ask GPT about Unity/NeonLadder development')
    //     .addStringOption(option =>
    //         option.setName('question')
    //             .setDescription('Your question for GPT')
    //             .setRequired(true)
    //     ),

    // Disabled - requires GitHub token
    // new SlashCommandBuilder()
    //     .setName('pbi-list')
    //     .setDescription('Get latest Product Backlog Items from GitHub'),

    new SlashCommandBuilder()
        .setName('steam-status')
        .setDescription('Check Steam launch readiness progress'),

    new SlashCommandBuilder()
        .setName('test-summary')
        .setDescription('Get Unity test results summary'),

    new SlashCommandBuilder()
        .setName('build-status')
        .setDescription('Check latest Unity build status'),

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and status'),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear conversation history for current channel'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display comprehensive help guide'),

    new SlashCommandBuilder()
        .setName('listrepos')
        .setDescription('List all configured repositories'),

    new SlashCommandBuilder()
        .setName('readme')
        .setDescription('Fetch README from GitHub repository')
        .addStringOption(option =>
            option.setName('repo')
                .setDescription('Repository name (auto-detects from channel if not provided)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('feature-request')
        .setDescription('Submit a feature request (use in *-feature-requests channels)')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Feature request title')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Detailed description of the feature')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('priority')
                .setDescription('Priority level')
                .setRequired(true)
                .addChoices(
                    { name: '🔴 CRITICAL - Blocking issues; drop everything', value: 'critical' },
                    { name: '🟠 URGENT - Time-sensitive tasks', value: 'urgent' },
                    { name: '🟡 HIGH - Important but not blocking', value: 'high' },
                    { name: '🟢 MEDIUM - Standard priority', value: 'medium' },
                    { name: '🔵 LOW - Nice to have', value: 'low' }
                )
        ),

    new SlashCommandBuilder()
        .setName('addrepo')
        .setDescription('Add a new repository category (Admin only)')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Repository name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('visibility')
                .setDescription('Repository visibility')
                .setRequired(false)
                .addChoices(
                    { name: 'Public', value: 'public' },
                    { name: 'Private', value: 'private' }
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('removerepo')
        .setDescription('Remove a repository category (Admin only)')
        .addStringOption(option =>
            option.setName('prefix')
                .setDescription('Repository prefix to remove')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('addrole')
        .setDescription('Add a custom role (Admin only)')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Role name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Hex color code (e.g., #FF0000)')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option.setName('mentionable')
                .setDescription('Can the role be mentioned?')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('hoisted')
                .setDescription('Display role separately in member list?')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup Discord server channels from config (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete messages from a user or webhook (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to purge messages from')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('webhook')
                .setDescription('Webhook/integration name to purge')
                .setRequired(false)
                .setAutocomplete(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('purge-all')
        .setDescription('Delete ALL messages in this channel (Admin only)')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Maximum number of messages to delete (default: 100, max: 1000)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// Register slash commands (guild-specific for instant updates)
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Refreshing slash commands...');

        // Clear global commands first (in case any old ones exist)
        console.log('🗑️  Clearing global commands...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID),
            { body: [] }
        );

        // Register for each guild (instant update) instead of globally (takes up to 1 hour)
        for (const guild of client.guilds.cache.values()) {
            // Clear existing guild commands first to avoid duplicates
            console.log(`🗑️  Clearing old commands for guild: ${guild.name}`);
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, guild.id),
                { body: [] }
            );

            // Small delay to ensure clearing completes
            await new Promise(resolve => setTimeout(resolve, 500));

            // Register new commands
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, guild.id),
                { body: commands.map(cmd => cmd.toJSON()) }
            );
            console.log(`✅ Registered ${commands.length} commands for guild: ${guild.name}`);
        }

        console.log('✅ Successfully registered all slash commands!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Load Discord structure configuration
async function loadDiscordStructure() {
    const configPath = path.join(__dirname, 'config', 'discord-structure.json');
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
}

// Setup Discord server according to IaC configuration
async function setupDiscordServer(guild) {
    console.log(`\n========================================`);
    console.log(`Setting up Discord server: ${guild.name}`);
    console.log(`========================================\n`);

    let structure;
    try {
        structure = await loadDiscordStructure();
        console.log(`✓ Loaded configuration: ${structure.categories.length} categories, ${structure.roles.length} roles`);
    } catch (error) {
        console.error(`❌ Failed to load discord-structure.json:`, error);
        throw error;
    }

    // Create roles
    console.log('\n--- Creating Roles ---');
    const createdRoles = {};
    for (const roleConfig of structure.roles) {
        try {
            const existingRole = guild.roles.cache.find(r => r.name === roleConfig.name);
            if (!existingRole) {
                console.log(`Creating role: ${roleConfig.name}...`);
                const role = await guild.roles.create({
                    name: roleConfig.name,
                    color: roleConfig.color,
                    permissions: roleConfig.permissions.map(p => PermissionFlagsBits[p]),
                    mentionable: roleConfig.mentionable,
                    hoist: roleConfig.hoist,
                });
                createdRoles[roleConfig.name] = role;
                console.log(`✓ Created role: ${roleConfig.name} (ID: ${role.id})`);
            } else {
                createdRoles[roleConfig.name] = existingRole;
                console.log(`✓ Role already exists: ${roleConfig.name} (ID: ${existingRole.id})`);
            }
        } catch (error) {
            console.error(`❌ Failed to create role ${roleConfig.name}:`, error.message);
            throw error;
        }
    }

    // Create categories and channels
    console.log('\n--- Creating Categories & Channels ---');
    let totalChannelsCreated = 0;
    let totalChannelsSkipped = 0;

    for (const categoryConfig of structure.categories) {
        console.log(`\nProcessing category: ${categoryConfig.name}`);

        let category = guild.channels.cache.find(
            c => c.name === categoryConfig.name && c.type === 4 // 4 = GUILD_CATEGORY
        );

        if (!category) {
            try {
                console.log(`  Creating category: ${categoryConfig.name}...`);
                const permissionOverwrites = [];

                if (categoryConfig.permissions) {
                    for (const perm of categoryConfig.permissions) {
                        const roleId = perm.role === '@everyone'
                            ? guild.roles.everyone.id
                            : createdRoles[perm.role]?.id;

                        if (roleId) {
                            const overwrite = { id: roleId };
                            if (perm.allow) overwrite.allow = perm.allow.map(p => PermissionFlagsBits[p]);
                            if (perm.deny) overwrite.deny = perm.deny.map(p => PermissionFlagsBits[p]);
                            permissionOverwrites.push(overwrite);
                        }
                    }
                }

                category = await guild.channels.create({
                    name: categoryConfig.name,
                    type: 4,
                    permissionOverwrites,
                });
                console.log(`  ✓ Created category: ${categoryConfig.name}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`  ❌ Failed to create category ${categoryConfig.name}:`, error.message);
                throw error;
            }
        } else {
            console.log(`  ✓ Category already exists: ${categoryConfig.name}`);
        }

        // Create channels in category
        for (const channelConfig of categoryConfig.channels) {
            try {
                let channel = guild.channels.cache.find(
                    c => c.name === channelConfig.name && c.parentId === category.id
                );

                if (!channel) {
                    console.log(`    Creating channel: #${channelConfig.name}...`);
                    const permissionOverwrites = [];

                    if (channelConfig.permissions) {
                        for (const perm of channelConfig.permissions) {
                            const roleId = perm.role === '@everyone'
                                ? guild.roles.everyone.id
                                : createdRoles[perm.role]?.id;

                            if (roleId) {
                                const overwrite = { id: roleId };
                                if (perm.allow) overwrite.allow = perm.allow.map(p => PermissionFlagsBits[p]);
                                if (perm.deny) overwrite.deny = perm.deny.map(p => PermissionFlagsBits[p]);
                                permissionOverwrites.push(overwrite);
                            }
                        }
                    }

                    channel = await guild.channels.create({
                        name: channelConfig.name,
                        type: 0,
                        parent: category.id,
                        topic: channelConfig.topic,
                        permissionOverwrites,
                    });
                    console.log(`    ✓ Created channel: #${channelConfig.name}`);
                    totalChannelsCreated++;
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                    console.log(`    ✓ Channel already exists: #${channelConfig.name}`);
                    totalChannelsSkipped++;
                }
            } catch (error) {
                console.error(`    ❌ Failed to create channel #${channelConfig.name}:`, error.message);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`Discord server setup complete!`);
    console.log(`Channels created: ${totalChannelsCreated}`);
    console.log(`Channels skipped: ${totalChannelsSkipped}`);
    console.log(`========================================\n`);
}

// Bot event handlers
client.once('ready', async () => {
    console.log(`🤖 NeonLadder Assistant is online! Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers with ${client.users.cache.size} users`);

    // Set bot status
    client.user.setActivity('NeonLadder Development', { type: 'WATCHING' });

    // Initialize webhook server
    setDiscordClient(client);
    if (process.env.ENABLE_WEBHOOKS === 'true') {
        startWebhookServer();
    } else {
        console.log('ℹ️  Webhook server disabled (set ENABLE_WEBHOOKS=true to enable)');
    }

    // Register commands
    await registerCommands();
});

// Handle autocomplete
client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
        const { commandName, options } = interaction;

        if (commandName === 'purge') {
            const focusedValue = options.getFocused().toLowerCase();

            // Fetch recent messages to get unique webhook/bot names
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            const webhookNames = new Set();

            messages.forEach(msg => {
                if (msg.webhookId || msg.author.bot) {
                    webhookNames.add(msg.author.username);
                }
            });

            // Filter and return matching webhook names
            const choices = Array.from(webhookNames)
                .filter(name => name.toLowerCase().includes(focusedValue))
                .slice(0, 25) // Discord limits to 25 choices
                .map(name => ({ name: name, value: name }));

            await interaction.respond(choices);
        }
        return;
    }

    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    try {
        switch (commandName) {
            case 'ask-claude':
                await interaction.deferReply();
                const claudeQuestion = options.getString('question');
                try {
                    const claudeResponse = await askClaude(claudeQuestion, interaction.channelId);

                    // Discord has 2000 char limit for embed descriptions
                    let responseText = claudeResponse;
                    if (responseText.length > 1900) {
                        responseText = responseText.substring(0, 1900) + '... (truncated)';
                    }

                    const claudeEmbed = new EmbedBuilder()
                        .setColor('#9B59B6')
                        .setTitle('🧠 Claude AI Analysis')
                        .setDescription(responseText)
                        .addFields(
                            { name: '❓ Question', value: claudeQuestion.substring(0, 1000), inline: false }
                        )
                        .setFooter({ text: 'NeonLadder Dual-AI System - Claude Edition' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [claudeEmbed] });
                } catch (error) {
                    console.error('Claude error:', error);
                    await interaction.editReply(`❌ Error calling Claude: ${error.message}\n\nMake sure Claude CLI is installed and configured.`);
                }
                break;

            case 'pbi-list':
                await interaction.deferReply();
                const issues = await getGitHubIssues();
                
                if (issues.length === 0) {
                    await interaction.editReply('❌ Could not fetch PBIs from GitHub');
                    return;
                }

                const pbiEmbed = new EmbedBuilder()
                    .setColor('#0052CC')
                    .setTitle('📋 Latest Product Backlog Items')
                    .setDescription('Recent PBIs from GitHub Issues')
                    .setFooter({ text: `Total Open Issues: ${issues.length}` })
                    .setTimestamp();

                issues.slice(0, 5).forEach(issue => {
                    const labels = issue.labels.map(label => label.name).join(', ');
                    pbiEmbed.addFields({
                        name: `#${issue.number} ${issue.title}`,
                        value: `Labels: ${labels || 'None'}\n[View Issue](${issue.html_url})`,
                        inline: false
                    });
                });

                await interaction.editReply({ embeds: [pbiEmbed] });
                break;

            case 'steam-status':
                const steamEmbed = new EmbedBuilder()
                    .setColor('#1E88E5')
                    .setTitle('🚀 Steam Launch Status - Q1 2025')
                    .addFields(
                        { name: '✅ Completed', value: '• Core game systems\n• Save/Load functionality\n• 449 unit tests passing\n• Steam integration basic setup', inline: true },
                        { name: '🔄 In Progress', value: '• Dialog save state integration\n• Procedural scene loading\n• Enemy NavMesh fixes\n• Build & deploy menu', inline: true },
                        { name: '📊 Progress', value: '~75% Steam Ready\nQ1 2025 on track', inline: false }
                    )
                    .setFooter({ text: 'Updated automatically via GitHub Issues' })
                    .setTimestamp();

                await interaction.reply({ embeds: [steamEmbed] });
                break;

            case 'test-summary':
                const testEmbed = new EmbedBuilder()
                    .setColor('#4CAF50')
                    .setTitle('🧪 Unity Test Summary')
                    .addFields(
                        { name: '📊 Test Coverage', value: '449 tests across 33 files', inline: true },
                        { name: '✅ Status', value: 'Last run: Mostly passing\nCLI runner operational', inline: true },
                        { name: '🔧 Test Categories', value: '• Runtime tests\n• Editor tests\n• Integration tests\n• UI tests', inline: false }
                    )
                    .setFooter({ text: 'Run via Unity CLI TestRunnerApi' })
                    .setTimestamp();

                await interaction.reply({ embeds: [testEmbed] });
                break;

            case 'build-status':
                const buildEmbed = new EmbedBuilder()
                    .setColor('#FF9800')
                    .setTitle('🔨 Unity Build Status')
                    .addFields(
                        { name: '⚙️ Unity Version', value: '6000.0.26f1 (Unity 6)', inline: true },
                        { name: '🎯 Target Platform', value: 'Windows Steam', inline: true },
                        { name: '📦 Build Pipeline', value: 'URP 2.5D Pipeline\nAutomated via CLI', inline: false }
                    )
                    .setDescription('Build system ready for Steam deployment')
                    .setFooter({ text: 'Automated builds via NeonLadder CI/CD' })
                    .setTimestamp();

                await interaction.reply({ embeds: [buildEmbed] });
                break;

            case 'ping':
                await interaction.reply(`Pong! 🏓 Latency: ${client.ws.ping}ms`);
                break;

            case 'clear':
                clearConversation(interaction.channelId);
                await interaction.reply('✅ Conversation history cleared for this channel.');
                break;

            case 'readme':
                let repoName = options.getString('repo');

                // Auto-detect repo from channel if not provided
                if (!repoName) {
                    repoName = detectRepoFromChannel(interaction.channel);
                    if (!repoName) {
                        await interaction.reply('❌ Could not detect repository from channel category. Please use this command in a project channel or specify the repo name manually.');
                        break;
                    }
                }

                await fetchAndDisplayReadme(interaction, repoName);
                break;

            case 'feature-request':
                // Check if in feature-requests channel
                if (!interaction.channel.name.includes('feature-request')) {
                    await interaction.reply('❌ This command can only be used in `*-feature-requests` channels.');
                    break;
                }

                const title = options.getString('title');
                const description = options.getString('description');
                const priority = options.getString('priority');
                const requestRepo = detectRepoFromChannel(interaction.channel);

                if (!requestRepo) {
                    await interaction.reply('❌ Could not detect repository from channel category.');
                    break;
                }

                const priorityEmoji = {
                    'critical': '🔴',
                    'urgent': '🟠',
                    'high': '🟡',
                    'medium': '🟢',
                    'low': '🔵'
                };

                const priorityLabel = {
                    'critical': 'priority: critical',
                    'urgent': 'priority: urgent',
                    'high': 'priority: high',
                    'medium': 'priority: medium',
                    'low': 'priority: low'
                };

                const needsApproval = ['critical', 'urgent'].includes(priority);

                const requestEmbed = new EmbedBuilder()
                    .setColor(needsApproval ? '#FF6B6B' : '#4ECDC4')
                    .setTitle(`${priorityEmoji[priority]} Feature Request: ${title}`)
                    .setDescription(description)
                    .addFields(
                        { name: 'Repository', value: requestRepo, inline: true },
                        { name: 'Priority', value: priority.toUpperCase(), inline: true },
                        { name: 'Requested by', value: `${interaction.user.tag}`, inline: true }
                    )
                    .setTimestamp();

                if (needsApproval) {
                    requestEmbed.setFooter({ text: '⏳ Awaiting admin approval - React with ✅ to approve' });
                }

                await interaction.reply({ embeds: [requestEmbed] });
                const reply = await interaction.fetchReply();

                if (needsApproval) {
                    await reply.react('✅');

                    // Wait for admin approval
                    const filter = (reaction, user) => {
                        return reaction.emoji.name === '✅' && !user.bot && isAdmin(interaction.guild.members.cache.get(user.id));
                    };

                    try {
                        await reply.awaitReactions({ filter, max: 1, time: 86400000, errors: ['time'] });

                        // Admin approved - create issue
                        const { Octokit } = require('@octokit/rest');
                        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
                        const owner = process.env.GITHUB_OWNER || 'irsiksoftware';

                        const issueBody = `${description}\n\n---\n**Priority:** ${priority.toUpperCase()}\n**Requested by:** ${interaction.user.tag} via Discord\n**Approved by:** Admin`;

                        const issue = await octokit.rest.issues.create({
                            owner: owner,
                            repo: requestRepo,
                            title: title,
                            body: issueBody,
                            labels: ['enhancement', priorityLabel[priority]]
                        });

                        await interaction.followUp(`✅ **Approved!** Feature request created: ${issue.data.html_url}`);
                    } catch (error) {
                        if (error.message === 'time') {
                            await interaction.followUp('⏱️ Request timed out after 24 hours without admin approval.');
                        } else {
                            console.error('Error creating GitHub issue:', error);
                            await interaction.followUp(`❌ Error creating GitHub issue: ${error.message}`);
                        }
                    }
                } else {
                    // No approval needed - create issue immediately
                    try {
                        const { Octokit } = require('@octokit/rest');
                        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
                        const owner = process.env.GITHUB_OWNER || 'irsiksoftware';

                        const issueBody = `${description}\n\n---\n**Priority:** ${priority.toUpperCase()}\n**Requested by:** ${interaction.user.tag} via Discord`;

                        const issue = await octokit.rest.issues.create({
                            owner: owner,
                            repo: requestRepo,
                            title: title,
                            body: issueBody,
                            labels: ['enhancement', priorityLabel[priority]]
                        });

                        await interaction.followUp(`✅ Feature request created: ${issue.data.html_url}`);
                    } catch (error) {
                        console.error('Error creating GitHub issue:', error);
                        await interaction.followUp(`❌ Error creating GitHub issue: ${error.message}`);
                    }
                }
                break;

            case 'help':
                const isAdminUser = isAdmin(interaction.member);

                const helpEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('🤖 NeonLadder Bot - Help')
                    .setDescription('Here are the available commands and features:')
                    .addFields(
                        { name: '💬 Mention Bot', value: 'Tag the bot with `@NeonLadder Bot <question>` to chat with Claude AI', inline: false },
                        { name: '🎮 AI Commands', value: '`/ask-claude` - Ask Claude AI', inline: false },
                        { name: '📊 Project Commands', value: '`/pbi-list` - GitHub issues\n`/steam-status` - Steam progress\n`/test-summary` - Test results\n`/build-status` - Build info', inline: false },
                        { name: '⚙️ Bot Commands', value: '`/ping` - Check latency\n`/clear` - Clear conversation\n`/help` - This message\n`/listrepos` - List repos', inline: false }
                    );

                if (isAdminUser) {
                    helpEmbed.addFields(
                        { name: '🔧 Admin Commands', value: '`/addrepo` - Add repo category\n`/removerepo` - Remove repo\n`/addrole` - Add role\n`/setup` - Create channels\n`/purge` - Delete messages', inline: false }
                    );
                }

                helpEmbed.addFields(
                    { name: '🐛 Create GitHub Issues', value: 'Tag bot in `*-feature-requests` or `*-bug-reports` channels to create GitHub issues', inline: false },
                    { name: '📄 Fetch README', value: 'Tag bot with `@bot readme <repo-name>` to fetch repository README', inline: false }
                );

                helpEmbed.setFooter({ text: 'NeonLadder Development Assistant' })
                    .setTimestamp();

                await interaction.reply({ embeds: [helpEmbed] });
                break;

            case 'listrepos':
                await interaction.deferReply();
                try {
                    const config = await loadDiscordStructure();

                    const repoCategories = config.categories.filter(cat =>
                        cat.name.includes('📦')
                    );

                    if (repoCategories.length === 0) {
                        await interaction.editReply('No repositories configured.');
                        break;
                    }

                    const repoEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('📦 Configured Repositories')
                        .setDescription('List of all configured repository categories');

                    for (const cat of repoCategories) {
                        const isPrivate = cat.permissions?.some(p => p.role === '@everyone' && p.deny);
                        const prefix = cat.channels[0].name.split('-')[0];
                        repoEmbed.addFields({
                            name: cat.name,
                            value: `Type: ${isPrivate ? '🔒 Private' : '🌐 Public'}\nPrefix: \`${prefix}-\`\nChannels: ${cat.channels.length}`,
                            inline: true
                        });
                    }

                    await interaction.editReply({ embeds: [repoEmbed] });
                } catch (error) {
                    console.error('Error listing repos:', error);
                    await interaction.editReply(`❌ Error listing repositories: ${error.message}`);
                }
                break;

            case 'addrepo':
                await interaction.deferReply();
                const addRepoName = options.getString('name');
                const visibility = options.getString('visibility') || 'public';
                const isPrivate = visibility === 'private';
                const prefix = addRepoName.toLowerCase().replace(/\s+/g, '');

                try {
                    const config = await loadDiscordStructure();

                    const exists = config.categories.find(cat =>
                        cat.name.toLowerCase().includes(prefix)
                    );

                    if (exists) {
                        await interaction.editReply(`❌ A category for "${addRepoName}" already exists.`);
                        break;
                    }

                    const newCategory = {
                        name: `📦 ${addRepoName}`,
                        description: isPrivate ? 'Private Project' : 'Public Project',
                        channels: [
                            { name: `${prefix}-general`, type: 'text', topic: `General discussion about ${addRepoName}` },
                            { name: `${prefix}-feature-requests`, type: 'text', topic: `Request features for ${addRepoName} - Tag the bot to create GitHub issues` },
                            { name: `${prefix}-bug-reports`, type: 'text', topic: `Report bugs - Tag the bot to create GitHub issues` },
                            { name: `${prefix}-commits`, type: 'text', topic: 'Automated commit feed from GitHub', permissions: [{ role: '@everyone', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }] },
                            { name: `${prefix}-releases`, type: 'text', topic: 'Automated release announcements from GitHub', permissions: [{ role: '@everyone', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }] },
                            { name: `${prefix}-discussions`, type: 'text', topic: `Community discussions about ${addRepoName}` }
                        ]
                    };

                    if (isPrivate) {
                        newCategory.permissions = [{ role: '@everyone', deny: ['ViewChannel'] }];
                    }

                    config.categories.push(newCategory);
                    const configPath = path.join(__dirname, 'config', 'discord-structure.json');
                    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

                    await interaction.editReply(
                        `✅ Repository "${addRepoName}" added to configuration!\n` +
                        `**Type**: ${isPrivate ? 'Private' : 'Public'}\n` +
                        `**Channels**: ${prefix}-general, ${prefix}-feature-requests, ${prefix}-bug-reports, ${prefix}-commits, ${prefix}-releases, ${prefix}-discussions\n\n` +
                        `Run \`/setup\` to create the Discord channels.`
                    );
                } catch (error) {
                    console.error('Error adding repo:', error);
                    await interaction.editReply(`❌ Error adding repository: ${error.message}`);
                }
                break;

            case 'removerepo':
                await interaction.deferReply();
                const removePrefix = options.getString('prefix').toLowerCase();

                try {
                    const config = await loadDiscordStructure();

                    const categoryIndex = config.categories.findIndex(cat =>
                        cat.name.toLowerCase().includes(removePrefix)
                    );

                    if (categoryIndex === -1) {
                        await interaction.editReply(`❌ Repository with prefix "${removePrefix}" not found.`);
                        break;
                    }

                    const removed = config.categories.splice(categoryIndex, 1)[0];
                    const configPath = path.join(__dirname, 'config', 'discord-structure.json');
                    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

                    await interaction.editReply(
                        `✅ Repository configuration removed: ${removed.name}\n\n` +
                        `**Note**: This only removes it from the config. To delete Discord channels, use Discord's interface.`
                    );
                } catch (error) {
                    console.error('Error removing repo:', error);
                    await interaction.editReply(`❌ Error removing repository: ${error.message}`);
                }
                break;

            case 'addrole':
                await interaction.deferReply();
                const roleName = options.getString('name');
                const color = options.getString('color');
                const mentionable = options.getBoolean('mentionable') ?? false;
                const hoisted = options.getBoolean('hoisted') ?? false;

                try {
                    const config = await loadDiscordStructure();

                    const exists = config.roles.find(r => r.name === roleName);
                    if (exists) {
                        await interaction.editReply(`❌ Role "${roleName}" already exists in configuration.`);
                        break;
                    }

                    const newRole = {
                        name: roleName,
                        color: color,
                        permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                        mentionable: mentionable,
                        hoist: hoisted
                    };

                    config.roles.push(newRole);
                    const configPath = path.join(__dirname, 'config', 'discord-structure.json');
                    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

                    await interaction.editReply(
                        `✅ Role "${roleName}" added to configuration!\n` +
                        `**Color**: ${color}\n` +
                        `**Mentionable**: ${mentionable ? 'Yes' : 'No'}\n` +
                        `**Hoisted**: ${hoisted ? 'Yes' : 'No'}\n\n` +
                        `Run \`/setup\` to create the role in Discord.`
                    );
                } catch (error) {
                    console.error('Error adding role:', error);
                    await interaction.editReply(`❌ Error adding role: ${error.message}`);
                }
                break;

            case 'setup':
                await interaction.deferReply();
                try {
                    await interaction.editReply('Starting Discord server setup...');
                    await setupDiscordServer(interaction.guild);
                    await interaction.followUp('✅ Discord server setup complete!');
                } catch (error) {
                    await interaction.editReply(`❌ Error during setup: ${error.message}`);
                }
                break;

            case 'purge':
                // Defer ephemerally and delete the response immediately
                await interaction.deferReply({ ephemeral: true });

                try {
                    const targetUser = options.getUser('user');
                    const webhookName = options.getString('webhook');

                    let targetName;
                    let filterFunc;

                    if (targetUser) {
                        // Delete by user ID
                        targetName = targetUser.username;
                        filterFunc = (m) => m.author.id === targetUser.id;
                    } else if (webhookName) {
                        // Delete by webhook/bot name
                        targetName = webhookName;
                        filterFunc = (m) => m.author.username.toLowerCase().includes(webhookName.toLowerCase());
                    } else {
                        // Default to current bot
                        targetName = client.user.username;
                        filterFunc = (m) => m.author.id === client.user.id;
                    }

                    let deleted = 0;
                    let lastId;

                    while (true) {
                        const fetchOptions = { limit: 100 };
                        if (lastId) fetchOptions.before = lastId;

                        const messages = await interaction.channel.messages.fetch(fetchOptions);
                        if (messages.size === 0) break;

                        const targetMessages = messages.filter(filterFunc);

                        for (const msg of targetMessages.values()) {
                            try {
                                await msg.delete();
                                deleted++;
                                await new Promise(resolve => setTimeout(resolve, 200));
                            } catch (err) {
                                console.error('Error deleting message:', err);
                            }
                        }

                        if (messages.size < 100) break;
                        lastId = messages.last().id;
                    }

                    // Delete the ephemeral "thinking" message
                    await interaction.deleteReply();
                    console.log(`Purged ${deleted} messages from ${targetName} in ${interaction.channel.name}`);
                } catch (error) {
                    console.error('Error purging messages:', error);
                    await interaction.editReply(`❌ Error: ${error.message}`);
                }
                break;

            case 'purge-all':
                await interaction.deferReply();
                try {
                    const limit = options.getInteger('limit') || 100;

                    await interaction.editReply(`🗑️ Deleting up to **${limit}** messages in this channel...`);

                    let deleted = 0;
                    let remaining = limit;

                    while (remaining > 0) {
                        const fetchLimit = Math.min(remaining, 100);
                        const messages = await interaction.channel.messages.fetch({ limit: fetchLimit });

                        if (messages.size === 0) break;

                        // Delete messages one by one (slower but more reliable)
                        for (const msg of messages.values()) {
                            if (deleted >= limit) break;

                            try {
                                await msg.delete();
                                deleted++;
                                await new Promise(resolve => setTimeout(resolve, 100));
                            } catch (err) {
                                console.error('Error deleting message:', err);
                            }
                        }

                        remaining = limit - deleted;
                        if (messages.size < fetchLimit) break;
                    }

                    await interaction.followUp(`✅ Deleted ${deleted} message(s) from this channel.`);
                    console.log(`Purged ${deleted} messages from ${interaction.channel.name}`);
                } catch (error) {
                    console.error('Error purging all messages:', error);
                    await interaction.editReply(`❌ Error purging messages: ${error.message}`);
                }
                break;

            default:
                await interaction.reply('❓ Unknown command!');
        }
    } catch (error) {
        console.error('Command execution error:', error);
        if (interaction.deferred) {
            await interaction.editReply('❌ An error occurred while executing the command.');
        } else {
            await interaction.reply('❌ An error occurred while executing the command.');
        }
    }
});

// Message-based commands and bot mentions
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Handle bot mentions for Claude conversations
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
            '• `/ask-claude` - Ask Claude a question\n' +
            '• `/feature-request` - Submit a feature request\n' +
            '• `/readme` - Fetch a repository README\n' +
            '• `/help` - See all available commands'
        );
        return;
    }

});

// Error handling
client.on('error', console.error);
client.on('warn', console.warn);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);