const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', '..', 'logs', 'claude-sessions');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Log to both console and file
 */
function log(logFile, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(logFile, logMessage);
}

/**
 * Ask Claude CLI a question
 * @param {string} question - The question to ask
 * @returns {Promise<string>} - Claude's response
 */
async function askClaude(question) {
    // Create timestamped log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `claude-${timestamp}.txt`);

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const output = [];
        const errors = [];

        log(logFile, '========================================');
        log(logFile, 'CLAUDE CLI SESSION');
        log(logFile, '========================================');
        log(logFile, `Question: ${question}`);
        log(logFile, `Start Time: ${new Date().toLocaleTimeString()}`);
        log(logFile, '');

        // Build prompt with context
        const contextPrompt = `[Context: Software development with focus on Unity game development, Discord bots, and web applications]
You are a helpful software development expert. Provide concise, actionable advice.

${question}`;

        log(logFile, `Full Prompt Length: ${contextPrompt.length} characters`);
        log(logFile, 'Spawning claude CLI process with --dangerously-skip-permissions...');
        log(logFile, `Command: echo <prompt> | claude --dangerously-skip-permissions`);
        log(logFile, '');

        // Spawn claude CLI process with --dangerously-skip-permissions (matches temp-swarm pattern)
        // Pass prompt via stdin to avoid shell quoting issues with multiline prompts
        const claudeProcess = spawn('claude', ['--dangerously-skip-permissions'], {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        log(logFile, `Process spawned with PID: ${claudeProcess.pid}`);
        log(logFile, 'Writing prompt to stdin...');

        // Write prompt to stdin and close it
        claudeProcess.stdin.write(contextPrompt);
        claudeProcess.stdin.end();
        log(logFile, 'Prompt written to stdin, awaiting response...');

        // Collect stdout
        claudeProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            output.push(chunk);
            log(logFile, `STDOUT chunk received (${chunk.length} bytes)`);
            // Log first 200 chars of chunk for debugging
            log(logFile, `  Preview: ${chunk.substring(0, 200).replace(/\n/g, ' ')}`);
        });

        // Collect stderr
        claudeProcess.stderr.on('data', (data) => {
            const chunk = data.toString();
            errors.push(chunk);
            log(logFile, `STDERR chunk received (${chunk.length} bytes)`);
            log(logFile, `  Content: ${chunk}`);
        });

        // Handle process completion
        claudeProcess.on('close', (code) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            log(logFile, '');
            log(logFile, `Process closed with exit code: ${code}`);
            log(logFile, `Duration: ${duration} seconds`);
            log(logFile, `Total stdout size: ${output.join('').length} bytes`);
            log(logFile, `Total stderr size: ${errors.join('').length} bytes`);
            log(logFile, '');

            if (code === 0) {
                let cleanOutput = output.join('')
                    .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
                    .replace(/[\r\n]+/g, '\n')
                    .trim();

                log(logFile, 'SUCCESS: Process completed successfully');
                log(logFile, `Response length: ${cleanOutput.length} characters`);
                log(logFile, '========================================');

                resolve(cleanOutput || 'Claude responded but produced no output.');
            } else {
                const errorMsg = `Claude CLI exited with code ${code}: ${errors.join('')}`;
                log(logFile, `ERROR: ${errorMsg}`);
                log(logFile, '========================================');
                reject(new Error(errorMsg));
            }
        });

        // Handle process errors
        claudeProcess.on('error', (error) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            log(logFile, '');
            log(logFile, `ERROR: Failed to spawn process after ${duration} seconds`);
            log(logFile, `Error message: ${error.message}`);
            log(logFile, `Error code: ${error.code}`);
            log(logFile, '========================================');
            reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
        });

        // Timeout after 2 minutes
        setTimeout(() => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            log(logFile, '');
            log(logFile, `TIMEOUT: Process exceeded 2 minute limit (${duration} seconds)`);
            log(logFile, `Stdout captured so far: ${output.join('').length} bytes`);
            log(logFile, `Stderr captured so far: ${errors.join('').length} bytes`);
            log(logFile, 'Killing process...');

            claudeProcess.kill();

            log(logFile, 'ERROR: Claude CLI timeout (2 minutes)');
            log(logFile, '========================================');
            reject(new Error('Claude CLI timeout (2 minutes)'));
        }, 120000);
    });
}

module.exports = {
    askClaude
};
