const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { Octokit } = require('@octokit/rest');

const CONFIG_PATH = path.join(__dirname, 'config', 'discord-structure.json');
const ENV_PATH = path.join(__dirname, '.env');

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const GITHUB_OWNER = process.env.GITHUB_OWNER || process.env.GITHUB_REPO?.split('/')[0];

// Helper to check if user is admin
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

// Load Discord structure config
async function loadConfig() {
  const data = await fs.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(data);
}

// Save Discord structure config
async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Add repository command
async function addRepoCommand(message, args) {
  if (!isAdmin(message.member)) {
    return message.reply('❌ You need Administrator permission to use this command.');
  }

  // Usage: !addrepo <repo-name> [public|private]
  if (args.length < 1) {
    return message.reply('Usage: `!addrepo <repo-name> [public|private]`\nExample: `!addrepo MyProject` or `!addrepo NeonLadder private`');
  }

  const repoName = args[0];
  const isPrivate = args[1]?.toLowerCase() === 'private';
  const prefix = repoName.toLowerCase().replace(/\s+/g, '');

  try {
    const config = await loadConfig();

    // Check if category already exists
    const exists = config.categories.find(cat =>
      cat.name.toLowerCase().includes(prefix)
    );

    if (exists) {
      return message.reply(`❌ A category for "${repoName}" already exists.`);
    }

    // Create new category structure
    const newCategory = {
      name: `📦 ${repoName}`,
      description: isPrivate ? 'Private Project' : 'Public Project',
      channels: [
        {
          name: `${prefix}-general`,
          type: 'text',
          topic: `General discussion about ${repoName}`
        },
        {
          name: `${prefix}-feature-requests`,
          type: 'text',
          topic: `Request features for ${repoName} - Tag the bot to create GitHub issues`
        },
        {
          name: `${prefix}-bug-reports`,
          type: 'text',
          topic: `Report bugs - Tag the bot to create GitHub issues`
        },
        {
          name: `${prefix}-commits`,
          type: 'text',
          topic: 'Automated commit feed from GitHub',
          permissions: isPrivate ? [
            {
              role: '@everyone',
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages']
            }
          ] : [
            {
              role: '@everyone',
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages']
            }
          ]
        },
        {
          name: `${prefix}-releases`,
          type: 'text',
          topic: 'Automated release announcements from GitHub',
          permissions: isPrivate ? [
            {
              role: '@everyone',
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages']
            }
          ] : [
            {
              role: '@everyone',
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages']
            }
          ]
        },
        {
          name: `${prefix}-discussions`,
          type: 'text',
          topic: `Community discussions about ${repoName}`
        }
      ]
    };

    // Add category-level permissions if private
    if (isPrivate) {
      newCategory.permissions = [
        {
          role: '@everyone',
          deny: ['ViewChannel']
        }
      ];
    }

    // Add to config
    config.categories.push(newCategory);
    await saveConfig(config);

    // Update .env file
    const envContent = await fs.readFile(ENV_PATH, 'utf8');
    const envVarName = `${prefix.toUpperCase()}_REPO`;

    if (!envContent.includes(envVarName)) {
      const newEnvLine = `\n${envVarName}=${repoName}\n`;
      await fs.appendFile(ENV_PATH, newEnvLine, 'utf8');
    }

    await message.reply(
      `✅ Repository "${repoName}" added to configuration!\n` +
      `**GitHub Repo**: ${repoName}\n` +
      `**Type**: ${isPrivate ? 'Private' : 'Public'}\n` +
      `**Channels**: ${prefix}-general, ${prefix}-feature-requests, ${prefix}-bug-reports, ${prefix}-commits, ${prefix}-releases, ${prefix}-discussions\n\n` +
      `Run \`!setup\` to create the Discord channels.`
    );

  } catch (error) {
    console.error('Error adding repo:', error);
    await message.reply(`❌ Error adding repository: ${error.message}`);
  }
}

// Remove repository command
async function removeRepoCommand(message, args) {
  if (!isAdmin(message.member)) {
    return message.reply('❌ You need Administrator permission to use this command.');
  }

  // Usage: !removerepo <repo-prefix>
  if (args.length < 1) {
    return message.reply('Usage: `!removerepo <repo-prefix>`\nExample: `!removerepo neonladder`');
  }

  const prefix = args[0].toLowerCase();

  try {
    const config = await loadConfig();

    const categoryIndex = config.categories.findIndex(cat =>
      cat.name.toLowerCase().includes(prefix)
    );

    if (categoryIndex === -1) {
      return message.reply(`❌ Repository with prefix "${prefix}" not found.`);
    }

    const removed = config.categories.splice(categoryIndex, 1)[0];
    await saveConfig(config);

    await message.reply(
      `✅ Repository configuration removed: ${removed.name}\n\n` +
      `**Note**: This only removes it from the config. To delete Discord channels, use Discord's interface.`
    );

  } catch (error) {
    console.error('Error removing repo:', error);
    await message.reply(`❌ Error removing repository: ${error.message}`);
  }
}

// List all configured repositories
async function listReposCommand(message) {
  try {
    const config = await loadConfig();

    const repoCategories = config.categories.filter(cat =>
      cat.name.includes('📦')
    );

    if (repoCategories.length === 0) {
      return message.reply('No repositories configured.');
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📦 Configured Repositories')
      .setDescription('List of all configured repository categories');

    for (const cat of repoCategories) {
      const isPrivate = cat.permissions?.some(p => p.role === '@everyone' && p.deny);
      const prefix = cat.channels[0].name.split('-')[0];
      embed.addFields({
        name: cat.name,
        value: `Type: ${isPrivate ? '🔒 Private' : '🌐 Public'}\nPrefix: \`${prefix}-\`\nChannels: ${cat.channels.length}`,
        inline: true
      });
    }

    await message.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error listing repos:', error);
    await message.reply(`❌ Error listing repositories: ${error.message}`);
  }
}

// Add custom role command
async function addRoleCommand(message, args) {
  if (!isAdmin(message.member)) {
    return message.reply('❌ You need Administrator permission to use this command.');
  }

  // Usage: !addrole <role-name> <color-hex> [mentionable] [hoisted]
  if (args.length < 2) {
    return message.reply('Usage: `!addrole <role-name> <color-hex> [yes/no mentionable] [yes/no hoisted]`\nExample: `!addrole Contributor #00FF00 yes no`');
  }

  const roleName = args[0];
  const color = args[1];
  const mentionable = args[2]?.toLowerCase() === 'yes';
  const hoisted = args[3]?.toLowerCase() === 'yes';

  try {
    const config = await loadConfig();

    // Check if role already exists in config
    const exists = config.roles.find(r => r.name === roleName);
    if (exists) {
      return message.reply(`❌ Role "${roleName}" already exists in configuration.`);
    }

    // Add to config
    const newRole = {
      name: roleName,
      color: color,
      permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
      mentionable: mentionable,
      hoist: hoisted
    };

    config.roles.push(newRole);
    await saveConfig(config);

    await message.reply(
      `✅ Role "${roleName}" added to configuration!\n` +
      `**Color**: ${color}\n` +
      `**Mentionable**: ${mentionable ? 'Yes' : 'No'}\n` +
      `**Hoisted**: ${hoisted ? 'Yes' : 'No'}\n\n` +
      `Run \`!setup\` to create the role in Discord.`
    );

  } catch (error) {
    console.error('Error adding role:', error);
    await message.reply(`❌ Error adding role: ${error.message}`);
  }
}

// Determine which repo based on channel name
function getRepoFromChannel(channelName) {
  const prefix = channelName.split('-')[0];
  const envKey = `${prefix.toUpperCase()}_REPO`;
  return process.env[envKey] || null;
}

// Determine issue type from channel name
function getIssueTypeFromChannel(channelName) {
  if (channelName.includes('feature-request')) {
    return 'feature';
  } else if (channelName.includes('bug-report')) {
    return 'bug';
  }
  return null;
}

// Create GitHub issue from Discord message
async function createGitHubIssue(repo, title, body, issueType, author) {
  const labels = issueType === 'feature' ? ['enhancement'] : ['bug'];
  const issueBody = `${body}\n\n---\n*Reported by ${author} via Discord*`;

  try {
    const response = await octokit.rest.issues.create({
      owner: GITHUB_OWNER,
      repo: repo,
      title: title,
      body: issueBody,
      labels: labels,
    });

    return response.data;
  } catch (error) {
    console.error('Error creating GitHub issue:', error);
    throw error;
  }
}

// Fetch README from GitHub repo
async function fetchRepoReadme(repoName) {
  try {
    const response = await octokit.rest.repos.getReadme({
      owner: GITHUB_OWNER,
      repo: repoName,
    });

    // Decode base64 content
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    console.error(`Error fetching README for ${repoName}:`, error.message);
    throw error;
  }
}

// Convert GitHub markdown to Discord-friendly format
function convertMarkdownToDiscord(markdown) {
  let discord = markdown;

  // Convert headers to bold
  discord = discord.replace(/^### (.*$)/gim, '**$1**');
  discord = discord.replace(/^## (.*$)/gim, '**__$1__**');
  discord = discord.replace(/^# (.*$)/gim, '**__$1__**');

  // Remove HTML comments
  discord = discord.replace(/<!--[\s\S]*?-->/g, '');

  // Convert GitHub badges/images to just links
  discord = discord.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]($2)');

  return discord.trim();
}

// Help command
async function helpCommand(message) {
  const isAdminUser = isAdmin(message.member);

  const helpEmbed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🤖 NeonLadder Bot - Help')
    .setDescription('Here are the available commands and features:')
    .addFields(
      { name: '💬 Mention Bot', value: 'Tag the bot with `@NeonLadder Bot <question>` to chat with Claude AI', inline: false },
      { name: '🎮 Slash Commands', value: '`/ask-claude` - Ask Claude AI\n`/readme` - Fetch repo README\n`/feature-request` - Submit feature request\n`/purge` - Delete messages (Admin)', inline: false },
      { name: '⚙️ Bot Commands', value: '`!ping` - Check latency\n`!clear` - Clear conversation\n`!help` - This message\n`!listrepos` - List configured repos', inline: false }
    );

  if (isAdminUser) {
    helpEmbed.addFields(
      { name: '🔧 Admin: Repo Management', value: '`!addrepo <name> [public|private]` - Add repo category\n`!removerepo <prefix>` - Remove repo\n`!setup` - Create Discord channels from config', inline: false },
      { name: '👥 Admin: Other', value: '`!addrole <name> <color> [yes/no] [yes/no]` - Add role\n`!purge [user]` - Delete messages', inline: false }
    );
  }

  helpEmbed.addFields(
    { name: '🐛 Create GitHub Issues', value: 'Tag bot in `*-feature-requests` or `*-bug-reports` channels to create GitHub issues', inline: false },
    { name: '📄 Fetch README', value: 'Tag bot with `@bot readme <repo-name>` to fetch repository README', inline: false }
  );

  helpEmbed.setFooter({ text: 'NeonLadder Development Assistant' })
    .setTimestamp();

  await message.reply({ embeds: [helpEmbed] });
}

module.exports = {
  isAdmin,
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
};
