#!/usr/bin/env node

// index.js - Simple entry point
const SimpleServer = require('./SimpleServer');

class SimpleBinaryPlotter {
    constructor() {
        this.server = null;
    }

    async run() {
        try {
            const args = process.argv.slice(2);
            const port = this.getPortFromArgs(args) || 3000;

            if (args.includes('--help') || args.includes('-h')) {
                this.showHelp();
                return;
            }

            console.log('Starting Simple Binary File Plotter...');

            // Start the server
            this.server = new SimpleServer();
            await this.server.start(port);

            // Auto-open browser
            this.openBrowser(`http://localhost:${port}`);
            
            console.log('Press Ctrl+C to stop the server');

        } catch (error) {
            console.error(`Application error: ${error.message}`);
            process.exit(1);
        }
    }

    getPortFromArgs(args) {
        const portIndex = args.findIndex(arg => arg === '--port' || arg === '-p');
        if (portIndex !== -1 && args[portIndex + 1]) {
            return parseInt(args[portIndex + 1]);
        }
        return null;
    }

    showHelp() {
        console.log(`
Simple Binary File Plotter

A tool for plotting multi-channel measurement data from binary files.

Usage: node index.js [options]

Options:
  --port, -p <number>    Port number for the web server (default: 3000)
  --help, -h            Show this help message

Examples:
  node index.js                    # Start on default port 3000
  node index.js --port 8080       # Start on port 8080

The web interface will automatically open in your browser.
Upload a .bin file to start plotting the 8-channel data.
`);
    }

    openBrowser(url) {
        const { spawn } = require('child_process');
        const platform = process.platform;
        let command;
        
        switch (platform) {
            case 'darwin':
                command = 'open';
                break;
            case 'win32':
                command = 'start';
                break;
            default:
                command = 'xdg-open';
                break;
        }

        try {
            spawn(command, [url], { 
                shell: true, 
                detached: true,
                stdio: 'ignore'
            });
        } catch (error) {
            console.warn(`Failed to open browser: ${error.message}`);
            console.info(`Please open your browser and navigate to: ${url}`);
        }
    }

    // Graceful shutdown
    async shutdown() {
        console.log('Shutting down...');
        if (this.server) {
            this.server.stop();
        }
    }
}

// Handle process signals
const plotter = new SimpleBinaryPlotter();

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down gracefully...');
    plotter.shutdown();
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Shutting down gracefully...');
    plotter.shutdown();
});

// Run if this file is executed directly
if (require.main === module) {
    plotter.run();
}

module.exports = SimpleBinaryPlotter;