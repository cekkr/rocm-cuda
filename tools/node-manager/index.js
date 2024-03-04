const readline = require('readline');
const { exec } = require('child_process');
const fs = require('fs')

function runCmd(command) {
    return new Promise((res) => {
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

            res({ stdout, stderr })
        });
    })
}

///
///
///

let env = {}

function loadEnv() {
    if (fs.existsSync(__dirname + '/env.json')) {
        let json = fs.readFileSync(__dirname + '/env.json').toString()
        env = JSON.parse(json)
    }
}

function saveEnv() {
    let json = JSON.stringify(env)
    fs.writeFileSync(__dirname + '/env.json', json)
}

////
////
////

function cmd_pull_codellama() {
    console.log("pull codellama!")
}

function cmd_pull_rocmcuda() {

}

function cmd_display_stop() {
    runCmd("systemctl stop gdm")
}

function cmd_display_start() {
    runCmd("systemctl start gdm")
}

function cmd_set(args) {
    let name = args.splice(0, 1)
    env[name] = args.join(' ')
    saveEnv()
}

function cmd_get(args) {
    let v = env[args[0]]
    console.log(v)
}

const cmds = {
    "pull": {
        "codellama": cmd_pull_codellama,
        "rocm-cuda": cmd_pull_rocmcuda
    },
    "display": {
        "stop": cmd_display_stop,
        "start": cmd_display_start
    },
    "set": cmd_set,
    "get": cmd_get
}

function interpret(line) {
    let parts = line.split(' ')
    let args = line.split(' ')
    let curCmds = cmds
    for (part of parts) {

        if (part == 'help') {
            for (let cmd in curCmds) {
                console.log('- ', cmd)
            }
            return;
        }

        if (!curCmds[part])
            break;

        curCmds = curCmds[part]
        args.splice(0, 1)

        if (typeof curCmds == 'function') {
            return curCmds(args)
        }
    }

    console.error("Invalid command:")
    for (let cmd in curCmds) {
        console.log('- ', cmd)
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

loadEnv()

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
