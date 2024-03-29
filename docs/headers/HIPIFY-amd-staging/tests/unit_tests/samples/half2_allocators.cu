// RUN: %run_test hipify "%s" "%t" %hipify_args 1 --hip-kernel-execution-syntax %clang_args

#pragma once
// CHECK: #include <hip/hip_runtime.h>
#include <cuda_runtime.h>
#include <math.h>
// CHECK: #include "hip/hip_fp16.h"
#include "cuda_fp16.h"
/**
 * Allocate GPU memory for `count` elements of type `T`.
 */
template<typename T>
static T *gpuMalloc(size_t count) {
    T *ret = nullptr;
    // CHECK: hipMalloc(&ret, count * sizeof(T));
    cudaMalloc(&ret, count * sizeof(T));
    return ret;
}

template<typename T>
__global__ void add(int n, T *x, T *y) {
  int index = blockIdx.x * blockDim.x + threadIdx.x;
  int stride = blockDim.x * gridDim.x;
  // CHECK: half2 tmp = __float2half2_rn(0.0f);
  half2 tmp = __float2half2_rn(0.0f);
  // CHECK: float max_val = fmax((float)reinterpret_cast<half&>(tmp.x), (float)reinterpret_cast<half&>(tmp.y));
  float max_val = fmax((float)tmp.x, (float)tmp.y);
  // CHECK: float min_val = fmin((float)reinterpret_cast<half&>(tmp.x), (float)reinterpret_cast<half&>(tmp.y));
  float min_val = fmin((float)reinterpret_cast<half&>(tmp.x), (float)reinterpret_cast<half&>(tmp.y));
  for (int i = index; i < n; i += stride)
      y[i] = max_val - min_val + x[i] + y[i];
}

int main(int argc, char* argv[]) {
    size_t numElements = 50;
    float *A = gpuMalloc<float>(numElements);
    float* B = gpuMalloc<float>(numElements);
    for (int i = 0; i < numElements; ++i) {
        A[i] = 1.0f;
        B[i] = 2.0f;
    }
    int blockSize = 512;
    int numBlocks = (numElements + blockSize - 1) / blockSize;
    dim3 dimGrid(numBlocks, 1, 1);
    dim3 dimBlock(blockSize, 1, 1);
    // CHECK: hipLaunchKernelGGL(HIP_KERNEL_NAME(add<float>), dim3(dimGrid), dim3(dimBlock), 0, 0, numElements, A, B);
    add<float><<<dimGrid, dimBlock>>>(numElements, A, B);
    // CHECK: hipDeviceSynchronize();
    cudaDeviceSynchronize();
    float maxError = 0.0f;
    for (int i = 0; i < numElements; ++i)
        maxError = fmax(maxError, fabs(B[i] - 3.0f));
    // CHECK: hipFree(A);
    cudaFree(A);
    // CHECK: hipFree(B);
    cudaFree(B);
    if (maxError == 0.0f)
        return 0;
    return -1;
}
