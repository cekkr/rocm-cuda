const readline = require('readline');
const { exec } = require('child_process');

function runCmd(command) {
    // Execute the command
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return;
        }

        // Print the command output
        console.log(stdout);

        // Print any command errors
        if (stderr) {
            console.error(`stderr: ${stderr}`);
        }

        // Prompt for the next command
        rl.prompt();
    });
}

////
////
////

function cmd_pull_codellama() {
    console.log("pull codellama!")
}

function cmd_pull_rocmcuda() {

}

const cmds = {
    "pull": {
        "codellama": cmd_pull_codellama,
        "rocm-cuda": cmd_pull_rocmcuda
    }
}

function interpret(line) {
    let parts = line.split(' ')
    let args = line.split(' ')
    let curCmds = cmds
    for (part of parts) {
        curCmds = curCmds[part]
        args.splice(0, 1)

        if (typeof curCmds == 'function') {
            return curCmds(args)
        }
    }
}

const completer = (line) => {
    let res = ''
    let curCmds = cmds
    let parts = line.split(' ')
    let hits = []
    for (let part of parts) {
        hits = []
        for (let cmd in curCmds) {
            if (cmd.startsWith(part)) {
                hits.push(res + cmd)
                curCmds = curCmds[cmd]
                break
            }
        }

        res += hits[0] + ' '
    }

    return [hits, line]
};

// Create readline interface for input and output
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '$> ',
    completer
});

// Prompt the user for input
rl.prompt();

// Event listener for line input
rl.on('line', (line) => {
    const command = line.trim();

    // If the command is 'exit', close the shell
    if (command === 'exit') {
        rl.close();
    } else {
        if (!interpret(command))
            rl.prompt();
    }
}).on('close', () => {
    console.log('Shell closed.');
    process.exit(0);
});
