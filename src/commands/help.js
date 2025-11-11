const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../services/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display comprehensive help guide'),

    async execute(interaction) {
        const isAdminUser = isAdmin(interaction.member);

        const helpEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🤖 NeonLadder Bot - Help')
            .setDescription('Here are the available commands and features:')
            .addFields(
                { name: '💬 Mention Bot', value: 'Tag the bot with `@NeonLadder Bot <question>` to chat with Claude AI', inline: false },
                { name: '🎮 AI Commands', value: '`/ask-claude` - Ask Claude AI about software development', inline: false },
                { name: '📄 Project Commands', value: '`/readme` - Fetch repository README\n`/feature-request` - Submit feature request', inline: false },
                { name: '⚙️ Bot Commands', value: '`/ping` - Check latency\n`/clear` - Clear conversation\n`/help` - This message', inline: false }
            );

        if (isAdminUser) {
            helpEmbed.addFields(
                { name: '🔧 Admin Commands', value: '`/purge` - Delete messages\n`/setup` - Create server channels\n`/addrepo` - Add repository\n`/removerepo` - Remove repository', inline: false }
            );
        }

        helpEmbed.addFields(
            { name: '🐛 Create GitHub Issues', value: 'Tag bot in `*-feature-requests` or `*-bug-reports` channels to create GitHub issues', inline: false },
            { name: '📄 Fetch README', value: 'Tag bot with `@bot readme <repo-name>` to fetch repository README', inline: false }
        );

        helpEmbed.setFooter({ text: 'NeonLadder Development Assistant' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed] });
    }
};
