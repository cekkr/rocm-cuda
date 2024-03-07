const readline = require('readline');
const { exec, spawn } = require('child_process');
const fs = require('fs')

function runCmd(command, prompt = true) {
    return new Promise((res) => {
        // Execute the command
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                res()
                if (prompt) rl.prompt()
                return;
            }

            // Print the command output
            console.log(stdout);

            // Print any command errors
            if (stderr) {
                console.error(`stderr: ${stderr}`);
            }

            res({ stdout, stderr })
            if (prompt) rl.prompt()
        });
    })
}

function runCmdStdin(line, prompt = true) {
    return new Promise((res) => {
        //const [command, ...args] = line.trim().split(/\s+/);
        //let spl = line.trim().split(/\s+/);

        let command = 'bash'
        let args = ['-c', line]

        // Use spawn to execute the command
        const child = spawn(command, args, {
            stdio: 'inherit', // This will inherit stdio from the parent, allowing direct interaction
        });

        child.on('close', (code) => {
            console.log(`Child process exited with code ${code}`);
            res()
            if (prompt) rl.prompt()
        });

        child.on('error', (err) => {
            console.error(`Failed to start subprocess: ${err.message}`);
            res()
            if (prompt) rl.prompt()
        });
    })
}

let llamaServerScript = null
let llamaServerScriptStop = false
function startCodeLlamaServer(path, mem = 0.5) {
    llamaServerScriptStop = false

    // Define your environment variable(s) here
    const env = { ...process.env, ACCELERATE_GPU_MEM: mem };

    // Spawn the shell script with the custom environment
    llamaServerScript = spawn(path, {
        env: env,
        shell: true, // This ensures that shell-specific syntax is correctly interpreted
    });

    llamaServerScript.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    llamaServerScript.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    llamaServerScript.on('close', (code) => {
        console.log(`Child process exited with code ${code}`);
        if (code !== 0) {
            console.log('Error detected, restarting the script...');

            if (!llamaServerScriptStop)
                startCodeLlamaServer(path, mem); // Restart the script if it crashes
        }
    });
}

function stopCodeLlamaServer() {
    if (llamaServerScript) {
        llamaServerScriptStop = true
        llamaServerScript.kill()
        llamaServerScript = null
    }
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
    let dir = env['codellama_path']
    if (!dir) {
        console.log('Variable codellama_path not setted')
        return;
    }

    runCmdStdin('cd ' + dir + ' && git pull')
    return true
}

function cmd_pull_rocmcuda() {
    let dir = __dirname + '/../../'
    runCmdStdin('cd ' + dir + ' && git pull')
}

function cmd_push_codellama() {
    let dir = env['codellama_path']
    if (!dir) {
        console.log('Variable codellama_path not setted')
        return;
    }

    runCmdStdin('cd ' + dir + ' && git add . && git commit -m "automatic commit" && git push')
}

function cmd_push_rocmcuda() {
    let dir = __dirname + '/../../'
    runCmdStdin('cd ' + dir + ' && git add . && git commit -m "automatic commit" && git push')
}


function cmd_display_stop() {
    runCmd("systemctl stop gdm")
}

function cmd_display_start() {
    runCmd("systemctl start gdm")
}

function cmd_run_codellama() {
    let dir = env['codellama_path']
    if (!dir) {
        console.log('Variable codellama_path not setted')
        return;
    }

    //runCmd('screen -dmS httpLlama bash -c "' + dir + '/CodeLlama/runHttpLlama.sh"')

    startCodeLlamaServer(dir + '/CodeLlama/runHttpLlama.sh', 0.25)
}

function cmd_stop_codellama() {
    stopCodeLlamaServer()
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

function cmd_notes() {
    console.log("Just some notes:")
    console.log("- If you have an AMD GPU you can monitor it in command line using amdgpu_top command")
}

const cmds = {
    "pull": {
        "codellama": cmd_pull_codellama,
        "rocm-cuda": cmd_pull_rocmcuda
    },
    "push": {
        "codellama": cmd_push_codellama,
        "rocm-cuda": cmd_push_rocmcuda
    },
    "run": {
        "codellama": cmd_run_codellama
    },
    "stop": {
        "codellama": cmd_stop_codellama
    },
    "display": {
        "stop": cmd_display_stop,
        "start": cmd_display_start
    },
    "set": cmd_set,
    "get": cmd_get,
    "notes": cmd_notes
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
