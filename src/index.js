#!/usr/bin/env node

// Simple index.js - Just start and plot
const SimplePlotter = require('./SimplePlotter');

async function main() {
    try {
        const args = process.argv.slice(2);
        const port = getPortFromArgs(args) || 3000;

        if (args.includes('--help') || args.includes('-h')) {
            showHelp();
            return;
        }

        console.log('Starting Simple Binary Plotter...');
        
        const plotter = new SimplePlotter();
        await plotter.start(port);
        
        // Auto-open browser
        openBrowser(`http://localhost:${port}`);
        
        console.log('Ready! The plot will load automatically.');
        console.log('Press Ctrl+C to stop.');

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            plotter.stop();
        });

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function getPortFromArgs(args) {
    const portIndex = args.findIndex(arg => arg === '--port' || arg === '-p');
    if (portIndex !== -1 && args[portIndex + 1]) {
        return parseInt(args[portIndex + 1]);
    }
    return null;
}

function showHelp() {
    console.log(`
Simple Binary Plotter

Usage: node index.js [options]

Options:
  --port, -p <number>    Port number (default: 3000)
  --help, -h            Show this help

Setup:
1. Put your .bin file in: data/measurement.bin
2. Run: node index.js
3. Browser opens automatically with the plot

Note: Edit SimplePlotter.js to change the file path.
`);
}

function openBrowser(url) {
    const { spawn } = require('child_process');
    const platform = process.platform;
    let command;
    
    switch (platform) {
        case 'darwin': command = 'open'; break;
        case 'win32': command = 'start'; break;
        default: command = 'xdg-open'; break;
    }

    try {
        spawn(command, [url], { 
            shell: true, 
            detached: true,
            stdio: 'ignore'
        });
    } catch (error) {
        console.warn('Could not open browser automatically.');
        console.info(`Please open: ${url}`);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };