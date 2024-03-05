import axios from 'axios'

async function fetchWithQuery(url, queryParams) {
    try {
        const response = await axios.get(url, { params: queryParams });
        return response.data;
    } catch (error) {
        console.error('Error making the request:', error);
    }
}

async function prompt(prompt, server) {
    const url = 'http://' + server + '/';
    const queryParams = { op: 'req', prompt };
    let res = await fetchWithQuery(url, queryParams);

    if (res == undefined) {
        throw new Error("server unavailable")
    }

    return res
}

let consecErrors = 0
function onResolve(req, server) {
    return new Promise((res) => {
        let interval = setInterval(async () => {
            const url = 'http://' + server + '/';
            const queryParams = { op: 'res', req };
            let resp = await fetchWithQuery(url, queryParams);

            if (resp != '-' && resp != undefined && resp != '0') {
                clearInterval(interval)
                res(resp)
                consecErrors = 0
            }
            else {
                if (resp == undefined || resp == '0') {
                    if (consecErrors++ > 4) {
                        throw new Error("server unavailable")
                    }
                }
                else {
                    consecErrors = 0
                }
            }

        }, 5000)
    })
}

export async function requestCodeLlama(myPrompt, server = "192.168.1.102:9500") {
    try {
        let req = await prompt(myPrompt, server)
        console.log("request num: ", req)

        let start = new Date().getTime()

        let res = await onResolve(req, server)

        let end = new Date().getTime()
        let diff = (end - start) / (1000 * 60)
        console.log("Prompt solved in ", diff, " minutes.")

        return res
    }
    catch {
        return await requestCodeLlama(myPrompt, server)
    }
}

