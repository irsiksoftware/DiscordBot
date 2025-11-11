const { spawn } = require('child_process');

/**
 * Ask Claude CLI a question
 * @param {string} question - The question to ask
 * @returns {Promise<string>} - Claude's response
 */
async function askClaude(question) {
    return new Promise((resolve, reject) => {
        const output = [];
        const errors = [];

        // Build prompt with context
        const contextPrompt = `[Context: Software development with focus on Unity game development, Discord bots, and web applications]
You are a helpful software development expert. Provide concise, actionable advice.

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

module.exports = {
    askClaude
};
