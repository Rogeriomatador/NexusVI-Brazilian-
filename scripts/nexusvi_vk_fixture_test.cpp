// SPDX-License-Identifier: GPL-3.0-or-later
#include "nexusvi_vk_fixture.hpp"
#include <iostream>
#include <limits>
void require(bool ok){if(!ok)throw std::runtime_error("test failure");}
int main(){
    uint64_t checks=0;
    for(uint32_t n=1;n<=nv::capacity;++n){auto g=nv::groups(n);require(g*64>=n&&(g-1)*64<n);++checks;}
    for(uint32_t mask=0;mask<256;++mask)for(uint32_t required=0;required<8;++required){
        std::vector<uint32_t> flags{0,1,2,3,4,5,6,7};uint32_t expected=8;
        for(uint32_t i=0;i<8;++i)if(((mask>>i)&1u)&&((flags[i]&required)==required)){expected=i;break;}
        uint32_t observed=8;try{observed=nv::memory_type(mask,flags,required);}catch(const std::runtime_error&){}
        require(observed==expected);++checks;
    }
    require(nv::memory_type(0x80000000u,std::vector<uint32_t>(32,3),3)==31);++checks;
    for(uint32_t n:nv::sizes)for(uint32_t i=0;i<nv::capacity;++i){
        uint64_t v=(uint64_t(i)*2654435761ull+0xffffffffull)&0xffffffffull;
        uint32_t ref=static_cast<uint32_t>(i<n?v*3+7:v);
        require(nv::expected(i,n,0xffffffffu)==ref);++checks;
    }
    for(uint32_t n:{0u,nv::capacity+1}){bool rejected=false;try{(void)nv::groups(n);}catch(const std::invalid_argument&){rejected=true;}require(rejected);++checks;}
    std::cout<<"{\"scope\":\"vulkan_fixture_host_only\",\"checks\":"<<checks<<",\"vulkan_executed\":false}\n";
}
