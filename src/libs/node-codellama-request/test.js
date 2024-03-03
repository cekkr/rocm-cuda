import { requestCodeLlama } from './index.js'

async function main() {

    let wrapper =
        `
        #include <iostream>
        #include <hip/hip_runtime.h>
        #include <hip/hip.h>

        extern "C"
        {
            // cudaGetDeviceCount wrapper using hipGetDeviceCount
            cudaError_t cudaGetDeviceCount(int *count)
            {
                std::cout << "Intercepted cudaGetDeviceCount call" << std::endl;
                hipError_t hipError = hipGetDeviceCount(count);
                return static_cast<cudaError_t>(hipError);
            }

            // cudaArrayGetInfo wrapper using hipArrayGetInfo
            cudaError_t cudaArrayGetInfo(cudaChannelFormatDesc *desc, cudaExtent *extent, unsigned int *flags, cudaArray_t array)
            {
        `

    //wrapper = 'void fibonacci(int num){\n'

    let res = await requestCodeLlama(wrapper)
    console.log("result: \n", res)
}

main()