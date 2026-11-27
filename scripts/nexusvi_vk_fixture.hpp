// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>
namespace nv {
constexpr uint32_t capacity=4113, local_size=64;
constexpr std::array<uint32_t,6> sizes{1,63,64,65,1024,4097};
inline uint32_t groups(uint32_t n) {
    if(n==0||n>capacity) throw std::invalid_argument("count");
    return (n-1)/local_size+1;
}
inline uint32_t memory_type(uint32_t bits,const std::vector<uint32_t>& flags,uint32_t required) {
    if(flags.size()>32) throw std::invalid_argument("memory types");
    for(uint32_t i=0;i<flags.size();++i)
        if((bits&(uint32_t(1)<<i))&&(flags[i]&required)==required) return i;
    throw std::runtime_error("no compatible memory type");
}
inline uint32_t initial(uint32_t i,uint32_t seed) {return i*2654435761u+seed;}
inline uint32_t expected(uint32_t i,uint32_t n,uint32_t seed) {
    auto v=initial(i,seed); return i<n?v*3u+7u:v;
}
}
