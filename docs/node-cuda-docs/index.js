const { JSDOM } = require("jsdom");
const jquery = require('jquery')
const https = require('https');
const he = require('he');
const fs = require('fs');

/**
 * Fetches the response body for a given URL using HTTPS.
 * @param {string} url - The URL to fetch.
 * @return {Promise<string>} The body of the response as a string.
 */
function fetchUrlBody(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            // Handle HTTP status codes other than 2xx
            if (response.statusCode < 200 || response.statusCode > 299) {
                reject(new Error('Failed to load page, status code: ' + response.statusCode));
            }

            let data = '';
            // A chunk of data has been received.
            response.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received.
            response.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function getJquery(body) {
    const { window } = new JSDOM(body);
    const $ = require("jquery")(window);
    return $;
}

let cudaTypes = []
function checkType(type) {
    if (!type) return;

    type = type.split('#')[0]
    if (cudaTypes.indexOf(type) < 0)
        cudaTypes.push(type)
}

async function readModule(module) {
    console.log("Reading module", module)

    let htmlModule = await fetchUrlBody('https://docs.nvidia.com/cuda/cuda-runtime-api/' + module.href)
    let $ = getJquery(htmlModule)

    let functions = []

    let $members = $('.members')
    let $dts = $members.find('dt')
    for (let dt of $dts) {
        try {
            let $dt = $(dt)

            let $member_type = $dt.find('.member_type')
            let member_type_keyword = $dt.find('.keyword').html()
            let $member_type_a = $member_type.find('a')
            let funReturn = $member_type_a.html()
            checkType($member_type_a.attr('href'))

            let $member_name = $dt.find('.member_name')
            let nodes = $member_name[0].childNodes

            let args = ''
            for (let n = 1; n < nodes.length; n++) {
                let node = nodes[n]
                if (node.nodeName == '#text') {
                    let text = node.wholeText
                    args += text
                }
                else {
                    let $node = $(node)
                    args += $node.html()
                }
            }
            args = he.decode(args)

            let name = $($member_name.find('a')[0]).html()

            functions.push({ keyword: member_type_keyword, return: funReturn, name, args })
        }
        catch {
            // check if it read useless information
        }
    }

    return functions
}

async function fetchModules() {
    // Retrieve modules index
    let htmlModulesIndex = await fetchUrlBody('https://docs.nvidia.com/cuda/cuda-runtime-api/modules.html')
    let $ = getJquery(htmlModulesIndex)

    let $modules = $('.section .li.cpp_specialisation')
    let modules = {}
    for (let mod of $modules) {
        $a = $(mod).find('a')
        let href = $a.attr('href')
        let name = $a.html()

        if (!name.includes('[DEPRECATED]')) {
            let module = {
                name,
                href
            }

            let funs = await readModule(module)
            modules[name] = funs
        }
    }

    return modules
}

async function main() {
    let res = {}
    res.modules = await fetchModules()

    let output = JSON.stringify(res)
    fs.writeFileSync('output.json', output)

    console.log("completed.")
}

main()