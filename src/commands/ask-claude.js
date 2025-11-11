const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { askClaude } = require('../services/claude');
const { checkPermission } = require('../services/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ask-claude')
        .setDescription('Ask Claude AI about software development')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Your question for Claude')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Check permissions
        const permission = await checkPermission(interaction, 'ask-claude');
        if (!permission.allowed) {
            return interaction.reply({ content: `❌ ${permission.reason}`, ephemeral: true });
        }

        await interaction.deferReply();
        const question = interaction.options.getString('question');

        try {
            const claudeResponse = await askClaude(question);

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
                    { name: '❓ Question', value: question.substring(0, 1000), inline: false }
                )
                .setFooter({ text: 'Powered by Claude AI' })
                .setTimestamp();

            await interaction.editReply({ embeds: [claudeEmbed] });
        } catch (error) {
            console.error('Claude error:', error);
            await interaction.editReply(`❌ Error calling Claude: ${error.message}\n\nMake sure Claude CLI is installed and configured.`);
        }
    }
};
