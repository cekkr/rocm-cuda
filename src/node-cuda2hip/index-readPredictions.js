import fs from 'fs'
import readline from 'readline'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function waitForEnter() {
    return new Promise(resolve => {
        rl.question('Press Enter to continue...', () => {
            resolve();
        });
    });
}

let status = {}

function loadStatus() {
    if (fs.existsSync('status.json')) {
        let json = fs.readFileSync('status.json').toString()
        status = JSON.parse(json)
    }
}

async function main() {
    loadStatus()

    for (let f in status.functions) {
        let fun = status.functions[f]

        if (fun.prediction) {
            console.log(fun.cuda)
            console.log(fun.prediction)

            await waitForEnter()
        }
    }
}

main()